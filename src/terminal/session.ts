import * as vscode from "vscode";
import * as fs from "fs";
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
import { isCmdShell, resolveShell } from "../utils/shell.js";
import {
  buildCmdCaptureCommand,
  createCmdCaptureFiles,
  readCaptureFile,
  type CmdCaptureFiles,
} from "../utils/cmd-capture.js";

interface TerminalExecutionResult {
  commandId: string;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

interface PendingTerminalExecution {
  command: CommandExecution;
  chunks: string[];
  started: boolean;
  ended: boolean;
  readComplete: boolean;
  exitCode: number | null;
  timedOut: boolean;
  resultResolved: boolean;
  startedResolve: () => void;
  completionResolve: (result: TerminalExecutionResult) => void;
  startedPromise: Promise<void>;
  completionPromise: Promise<TerminalExecutionResult>;
}

const SHELL_INTEGRATION_START_TIMEOUT_MS = 3000;
const CAPTURE_POLL_INTERVAL_MS = 100;

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
  private pendingExecution: PendingTerminalExecution | null = null;
  private suppressShellIntegrationCapture = false;
  private shellReady: Promise<void>;
  private shellReadyResolve!: () => void;

  constructor(config: TerminalSessionConfig, maxOutputLines: number) {
    this.sessionId = generateSessionId();
    this.name = config.name;
    this.cwd =
      config.cwd ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      process.cwd();
    this.env = config.env;
    this.shell = resolveShell(config.shell);
    this.agentId = config.agentId;
    this.createdAt = Date.now();
    this.outputBuffer = createOutputBuffer(maxOutputLines);

    const terminalOptions: vscode.TerminalOptions & {
      shellIntegration?: { enabled: boolean };
    } = {
      name: `BashTerm: ${config.name}`,
      cwd: this.cwd,
      env: config.env,
      shellIntegration: { enabled: true },
    };

    if (this.shell) {
      terminalOptions.shellPath = this.shell;
      if (isCmdShell(this.shell)) {
        terminalOptions.shellArgs = ["/d"];
      }
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

          const pending = this.pendingExecution;
          if (pending && !pending.started) {
            pending.started = true;
            pending.startedResolve();
          }

          try {
            const stream = event.execution.read();
            for await (const chunk of stream) {
              if (!this.suppressShellIntegrationCapture) {
                appendToBuffer(this.outputBuffer, chunk);
              }
              if (pending) {
                pending.chunks.push(chunk);
              }
            }
          } catch (err) {
            logError(
              `Error reading shell execution output in session ${this.sessionId}`,
              err,
            );
          } finally {
            if (pending) {
              pending.readComplete = true;
              this.tryCompletePendingExecution(pending);
            }
          }
        });

      if (vscode.window.onDidEndTerminalShellExecution) {
        this.shellExecutionEndDisposable =
          vscode.window.onDidEndTerminalShellExecution((event) => {
            if (event.terminal !== this.terminal) return;

            const pending = this.pendingExecution;
            if (pending && pending.started && !pending.ended) {
              pending.ended = true;
              pending.exitCode = event.exitCode ?? null;
              this.tryCompletePendingExecution(pending);
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
  ): Promise<TerminalExecutionResult> {
    log(
      `Executing command in session ${this.sessionId}: ${command.slice(0, 80)}`,
    );

    if (this.currentCommand) {
      throw new Error(
        "Terminal session is busy. Wait for the current command to finish or use another session.",
      );
    }

    if (!waitForCompletion) {
      const commandId = generateCommandId();
      const startedAt = Date.now();
      this.lastCommandAt = startedAt;
      this.terminal.show(true);
      this.terminal.sendText(command, true);

      return {
        commandId,
        output: "(command sent, not waiting for completion)",
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
      };
    }

    if (isCmdShell(this.shell)) {
      return this.executeWithCmdCapture(command, timeoutMs);
    }

    const commandId = generateCommandId();
    const startedAt = Date.now();
    this.lastCommandAt = startedAt;

    const commandExecution: CommandExecution = {
      commandId,
      command,
      startedAt,
      timedOut: false,
      outputStartLine: this.outputBuffer.lines.length,
    };
    const pending = this.createPendingExecution(commandExecution);

    this.currentCommand = commandExecution;
    this.pendingExecution = pending;

    // Show command in visible terminal for user viewing
    this.terminal.show(true);
    this.terminal.sendText(command, true);

    await Promise.race([
      pending.startedPromise,
      delay(SHELL_INTEGRATION_START_TIMEOUT_MS),
    ]);

    if (!pending.started) {
      this.finishUncapturedExecution(pending);
      return {
        commandId,
        output:
          "Command sent to the visible terminal, but VS Code shell integration did not start. Output and exit code cannot be captured without re-running the command.",
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
      };
    }

    return Promise.race([
      pending.completionPromise,
      delay(timeoutMs).then(() => this.resolveShellIntegrationTimeout(pending)),
    ]);
  }

  private createPendingExecution(
    command: CommandExecution,
  ): PendingTerminalExecution {
    let startedResolve!: () => void;
    let completionResolve!: (result: TerminalExecutionResult) => void;

    const startedPromise = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const completionPromise = new Promise<TerminalExecutionResult>(
      (resolve) => {
        completionResolve = resolve;
      },
    );

    return {
      command,
      chunks: [],
      started: false,
      ended: false,
      readComplete: false,
      exitCode: null,
      timedOut: false,
      resultResolved: false,
      startedResolve,
      completionResolve,
      startedPromise,
      completionPromise,
    };
  }

  private tryCompletePendingExecution(pending: PendingTerminalExecution): void {
    if (!pending.ended || !pending.readComplete) return;

    const completedAt = Date.now();
    pending.command.completedAt = completedAt;
    pending.command.exitCode = pending.exitCode ?? undefined;
    pending.command.timedOut = pending.timedOut;
    pending.command.outputEndLine = this.outputBuffer.lines.length;
    this.commandHistory.push(pending.command);

    if (this.pendingExecution === pending) {
      this.pendingExecution = null;
    }
    if (this.currentCommand === pending.command) {
      this.currentCommand = null;
    }

    if (!pending.resultResolved) {
      pending.resultResolved = true;
      pending.completionResolve({
        commandId: pending.command.commandId,
        output: pending.chunks.join("").trim(),
        exitCode: pending.exitCode,
        timedOut: pending.timedOut,
        durationMs: completedAt - pending.command.startedAt,
      });
    }
  }

  private resolveShellIntegrationTimeout(
    pending: PendingTerminalExecution,
  ): TerminalExecutionResult {
    pending.timedOut = true;
    pending.command.timedOut = true;

    if (!pending.resultResolved) {
      pending.resultResolved = true;
    }

    return {
      commandId: pending.command.commandId,
      output: pending.chunks.join("").trim(),
      exitCode: null,
      timedOut: true,
      durationMs: Date.now() - pending.command.startedAt,
    };
  }

  private finishUncapturedExecution(pending: PendingTerminalExecution): void {
    pending.command.completedAt = Date.now();
    pending.command.exitCode = undefined;
    pending.command.outputEndLine = this.outputBuffer.lines.length;
    this.commandHistory.push(pending.command);

    if (this.pendingExecution === pending) {
      this.pendingExecution = null;
    }
    if (this.currentCommand === pending.command) {
      this.currentCommand = null;
    }
  }

  private async executeWithCmdCapture(
    command: string,
    timeoutMs: number,
  ): Promise<TerminalExecutionResult> {
    const commandId = generateCommandId();
    const startedAt = Date.now();
    this.lastCommandAt = startedAt;

    const commandExecution: CommandExecution = {
      commandId,
      command,
      startedAt,
      timedOut: false,
      outputStartLine: this.outputBuffer.lines.length,
    };
    this.currentCommand = commandExecution;

    const files = createCmdCaptureFiles();
    const wrappedCommand = buildCmdCaptureCommand(
      command,
      files.stdoutPath,
      files.stderrPath,
      files.exitCodePath,
    );

    this.terminal.show(true);
    this.suppressShellIntegrationCapture = true;
    this.terminal.sendText(wrappedCommand, true);

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      commandExecution.timedOut = true;
    }, timeoutMs);

    try {
      await waitForFile(files.exitCodePath, () => timedOut);
    } finally {
      clearTimeout(timeoutHandle);
    }

    const stdout = readCaptureFile(files.stdoutPath, this.shell);
    const stderr = readCaptureFile(files.stderrPath, this.shell);
    const output = (stdout + (stderr ? "\n" + stderr : "")).trim();

    if (timedOut) {
      void this.finalizeCmdCaptureWhenReady(commandExecution, files);
      return {
        commandId,
        output,
        exitCode: null,
        timedOut: true,
        durationMs: Date.now() - startedAt,
      };
    }

    const exitCodeText = readCaptureFile(files.exitCodePath, this.shell).trim();
    const exitCode = timedOut ? null : Number.parseInt(exitCodeText, 10);
    const normalizedExitCode = Number.isFinite(exitCode) ? exitCode : null;

    this.finalizeCmdCapture(
      commandExecution,
      files,
      normalizedExitCode,
      output,
    );

    return {
      commandId,
      output,
      exitCode: normalizedExitCode,
      timedOut,
      durationMs: Date.now() - startedAt,
    };
  }

  private async finalizeCmdCaptureWhenReady(
    commandExecution: CommandExecution,
    files: CmdCaptureFiles,
  ): Promise<void> {
    await waitForFile(files.exitCodePath, () => !this.isActive);
    if (!this.isActive || !fs.existsSync(files.exitCodePath)) return;

    const stdout = readCaptureFile(files.stdoutPath, this.shell);
    const stderr = readCaptureFile(files.stderrPath, this.shell);
    const output = (stdout + (stderr ? "\n" + stderr : "")).trim();
    const exitCodeText = readCaptureFile(files.exitCodePath, this.shell).trim();
    const exitCode = Number.parseInt(exitCodeText, 10);
    const normalizedExitCode = Number.isFinite(exitCode) ? exitCode : null;

    this.finalizeCmdCapture(
      commandExecution,
      files,
      normalizedExitCode,
      output,
    );
  }

  private finalizeCmdCapture(
    commandExecution: CommandExecution,
    files: CmdCaptureFiles,
    exitCode: number | null,
    output: string,
  ): void {
    if (output) {
      appendToBuffer(this.outputBuffer, output);
    }

    commandExecution.completedAt = Date.now();
    commandExecution.exitCode = exitCode ?? undefined;
    commandExecution.outputEndLine = this.outputBuffer.lines.length;
    this.commandHistory.push(commandExecution);

    if (this.currentCommand === commandExecution) {
      this.currentCommand = null;
    }
    this.suppressShellIntegrationCapture = false;

    try {
      fs.rmSync(files.captureDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures; files are in the OS temp directory.
    }
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(
  filePath: string,
  shouldStop: () => boolean,
): Promise<void> {
  while (!fs.existsSync(filePath) && !shouldStop()) {
    await delay(CAPTURE_POLL_INTERVAL_MS);
  }
}
