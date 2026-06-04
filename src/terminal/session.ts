import * as vscode from "vscode";
import * as cp from "child_process";
import { TextDecoder } from "util";
import type {
  TerminalSessionConfig,
  TerminalSessionInfo,
  OutputBuffer,
  CommandExecution,
} from "../types/index.js";
import {
  createOutputBuffer,
  appendToBuffer,
  readFromBuffer,
  getBufferLineCount,
} from "./output-capture.js";
import { generateSessionId, generateCommandId } from "../utils/id-generator.js";
import { log, logError } from "../utils/logger.js";
import { buildExecOptions, detectShellEncoding } from "../utils/exec-options.js";

export class TerminalSession {
  readonly sessionId: string;
  readonly name: string;
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly shell?: string;
  readonly agentId?: string;
  readonly createdAt: number;

  private terminal: vscode.Terminal;
  private outputBuffer: OutputBuffer;
  private commandHistory: CommandExecution[] = [];
  private currentCommand: CommandExecution | null = null;
  private shellExecutionDisposable: vscode.Disposable | null = null;
  private shellExecutionEndDisposable: vscode.Disposable | null = null;
  private isActive = true;
  private lastCommandAt?: number;
  private shellIntegrationActive = false;
  private shellReady: Promise<void>;
  private shellReadyResolve!: () => void;

  constructor(config: TerminalSessionConfig, maxOutputLines: number) {
    this.sessionId = generateSessionId();
    this.name = config.name;
    this.cwd =
      config.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    this.env = config.env;
    this.shell = config.shell;
    this.agentId = config.agentId;
    this.createdAt = Date.now();
    this.outputBuffer = createOutputBuffer(maxOutputLines);

    const terminalOptions: vscode.TerminalOptions & { shellIntegration?: { enabled: boolean } } = {
      name: `BashTerm: ${config.name}`,
      cwd: this.cwd,
      env: config.env,
      shellIntegration: { enabled: true },
    };

    if (config.shell) {
      terminalOptions.shellPath = config.shell;
    }

    this.terminal = vscode.window.createTerminal(terminalOptions);
    this.terminal.show(false);

    // shellReady resolves when the terminal is ready to accept commands.
    // Falls back to a 2-second timeout if shell integration never fires.
    this.shellReady = new Promise<void>((resolve) => {
      this.shellReadyResolve = resolve;
      // Fallback: resolve after 2s even without shell integration signal
      setTimeout(resolve, 2000);
    });

    this.setupShellIntegrationCapture();

    log(`Session ${this.sessionId} created: ${config.name} (cwd: ${this.cwd})`);
  }

  private setupShellIntegrationCapture(): void {
    if (vscode.window.onDidStartTerminalShellExecution) {
      this.shellExecutionDisposable =
        vscode.window.onDidStartTerminalShellExecution(async (event) => {
          if (event.terminal !== this.terminal) return;

          log(
            `Shell execution started in session ${this.sessionId}: ${event.execution.commandLine?.value ?? "unknown"}`,
          );

          // Resolve the ready promise if still pending
          this.shellReadyResolve();

          this.shellIntegrationActive = true;

          try {
            const stream = event.execution.read();
            for await (const chunk of stream) {
              appendToBuffer(this.outputBuffer, chunk);
            }
          } catch (err) {
            logError(
              `Error reading shell execution output in session ${this.sessionId}`,
              err,
            );
          }
        });

      if (vscode.window.onDidEndTerminalShellExecution) {
        this.shellExecutionEndDisposable =
          vscode.window.onDidEndTerminalShellExecution((event) => {
            if (event.terminal !== this.terminal) return;

            this.shellIntegrationActive = false;

            if (this.currentCommand) {
              this.currentCommand.completedAt = Date.now();
              this.currentCommand.exitCode = event.exitCode;
              this.currentCommand.outputEndLine = this.outputBuffer.lines.length;
              this.commandHistory.push(this.currentCommand);
              this.currentCommand = null;
            }
            // Update lastCommandAt so the idle reaper doesn't kill the session immediately
            this.lastCommandAt = Date.now();

            log(
              `Shell execution ended in session ${this.sessionId} with exit code: ${event.exitCode}`,
            );
          });
      }
    }
  }

  async execute(
    command: string,
    timeoutMs: number,
    waitForCompletion: boolean,
  ): Promise<{
    commandId: string;
    output: string;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
  }> {
    log(`Executing command in session ${this.sessionId}: ${command.slice(0, 80)}`);

    const commandId = generateCommandId();
    const startedAt = Date.now();
    this.lastCommandAt = startedAt;

    this.currentCommand = {
      commandId,
      command,
      startedAt,
      timedOut: false,
      outputStartLine: this.outputBuffer.lines.length,
    };

    const outputStartIndex = this.outputBuffer.lines.length;

    // Show command in visible terminal for user viewing
    this.terminal.show(true);
    this.terminal.sendText(command, true);

    if (!waitForCompletion) {
      return {
        commandId,
        output: "(command sent, not waiting for completion)",
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
      };
    }

    return new Promise((resolve) => {
      let resolved = false;
      const isWin = process.platform === "win32";
      const options = buildExecOptions({
        cwd: this.cwd,
        timeoutMs,
        shell: this.shell,
        isWin,
      });

      const child = cp.exec(command, options, (error, stdout, stderr) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutHandle);

        let outStr: string;
        let errStr: string;
        if (isWin) {
          const textEncoding = detectShellEncoding(isWin, this.shell);
          const td = new TextDecoder(textEncoding);
          outStr = stdout ? td.decode(stdout as Buffer) : "";
          errStr = stderr ? td.decode(stderr as Buffer) : "";
        } else {
          outStr = stdout as string;
          errStr = (stderr as string) || "";
        }

        const output = (outStr + (errStr ? "\n" + errStr : "")).trim();

        // Only append to buffer if Shell Integration didn't already capture
        // (otherwise output appears twice in the read buffer).
        if (!this.shellIntegrationActive) {
          const lines = output.split("\n");
          for (const line of lines) {
            appendToBuffer(this.outputBuffer, line + "\r\n");
          }
        }

        // Shell Integration handles command finalization in onDidEndTerminalShellExecution.
        // Fall back to exec-based finalization only when shell integration is inactive.
        if (!this.shellIntegrationActive && this.currentCommand) {
          this.currentCommand.completedAt = Date.now();
          this.currentCommand.exitCode = error ? (error.code || 1) : 0;
          this.currentCommand.timedOut = !!(error && error.killed);
          this.currentCommand.outputEndLine = this.outputBuffer.lines.length;
          this.commandHistory.push(this.currentCommand);
          this.currentCommand = null;
        }

        resolve({
          commandId,
          output,
          exitCode: error ? (error.code || 1) : 0,
          timedOut: !!(error && error.killed),
          durationMs: Date.now() - startedAt,
        });
      });

      const timeoutHandle = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        child.kill();

        if (this.currentCommand) {
          this.currentCommand.timedOut = true;
          this.currentCommand.completedAt = Date.now();
          this.currentCommand.outputEndLine = this.outputBuffer.lines.length;
          this.commandHistory.push(this.currentCommand);
          this.currentCommand = null;
        }

        const output = this.outputBuffer.lines
          .slice(outputStartIndex)
          .join("\n");

        resolve({
          commandId,
          output,
          exitCode: null,
          timedOut: true,
          durationMs: Date.now() - startedAt,
        });
      }, timeoutMs);
    });
  }

  sendInput(input: string, pressEnter: boolean): void {
    this.terminal.sendText(input, pressEnter);
    this.lastCommandAt = Date.now();
    log(
      `Input sent to session ${this.sessionId}: ${input.slice(0, 50)}${input.length > 50 ? "..." : ""}`,
    );
  }

  readOutput(
    offset: number = 0,
    maxLines: number = 500,
  ): {
    lines: string[];
    readFrom: number;
    readCount: number;
    remaining: number;
    totalLines: number;
    isComplete: boolean;
  } {
    return readFromBuffer(this.outputBuffer, offset, maxLines);
  }

  /**
   * Returns a promise that resolves when the terminal shell is ready
   * to accept commands. Resolves early if shell integration fires,
   * otherwise falls back to a 2-second timeout.
   */
  whenReady(): Promise<void> {
    return this.shellReady;
  }

  get isBusy(): boolean {
    return this.currentCommand !== null;
  }

  getInfo(): TerminalSessionInfo {
    return {
      sessionId: this.sessionId,
      name: this.name,
      cwd: this.cwd,
      env: this.env,
      shell: this.shell,
      agentId: this.agentId,
      isActive: this.isActive,
      createdAt: this.createdAt,
      lastCommandAt: this.lastCommandAt,
      outputLineCount: getBufferLineCount(this.outputBuffer),
    };
  }

  getTerminal(): vscode.Terminal {
    return this.terminal;
  }

  isIdle(idleThresholdMs: number): boolean {
    if (idleThresholdMs <= 0) return false;
    const lastActivity = this.lastCommandAt ?? this.createdAt;
    return Date.now() - lastActivity > idleThresholdMs;
  }

  dispose(): void {
    this.isActive = false;
    this.shellExecutionDisposable?.dispose();
    this.shellExecutionEndDisposable?.dispose();
    this.terminal.dispose();
    log(`Session ${this.sessionId} disposed`);
  }
}
