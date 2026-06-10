import * as vscode from "vscode";
import type {
  TerminalSessionConfig,
  TerminalSessionInfo,
  OutputBuffer,
} from "../types/index.js";
import {
  createOutputBuffer,
  readFromBuffer,
  getBufferLineCount,
} from "./output-capture.js";
import { generateSessionId, generateCommandId } from "../utils/id-generator.js";
import { log } from "../utils/logger.js";
import { isCmdShell, resolveShell } from "../utils/shell.js";
import { CmdScriptExecutor } from "./executors/cmd-script-executor.js";
import { PowerShellScriptExecutor } from "./executors/powershell-script-executor.js";
import { ShellIntegrationExecutor } from "./executors/shell-integration-executor.js";
import type { TerminalExecutionResult } from "./executors/types.js";

export class TerminalSession {
  readonly sessionId: string;
  readonly name: string;
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly shell?: string;
  readonly shellKind?: "cmd" | "powershell" | "pwsh" | "vscode";
  readonly agentId?: string;
  readonly createdAt: number;

  private terminal: vscode.Terminal;
  private outputBuffer: OutputBuffer;
  private isActive = true;
  private lastCommandAt?: number;
  private shellReady: Promise<void>;
  private shellReadyResolve!: () => void;
  private shellIntegrationExecutor: ShellIntegrationExecutor;
  private cmdScriptExecutor: CmdScriptExecutor;
  private powershellScriptExecutor: PowerShellScriptExecutor | null = null;

  constructor(config: TerminalSessionConfig, maxOutputLines: number) {
    this.sessionId = generateSessionId();
    this.name = config.name;
    this.cwd =
      config.cwd ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      process.cwd();
    this.env = config.env;

    // Resolve the shell path from the caller-provided name (or undefined
    // for "VSCode default").  We never guess the OS-level shell here because
    // vscode.env.shell always returns cmd.exe on Windows regardless of the
    // user's VSCode terminal profile preference.
    this.shell = resolveShell(config.shell);
    this.shellKind = config.shellKind;
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
      setTimeout(resolve, 2000);
    });

    this.shellIntegrationExecutor = new ShellIntegrationExecutor({
      sessionId: this.sessionId,
      terminal: this.terminal,
      outputBuffer: this.outputBuffer,
      onActivity: () => this.markActivity(),
      onShellReady: () => this.shellReadyResolve(),
    });
    this.cmdScriptExecutor = new CmdScriptExecutor({
      terminal: this.terminal,
      outputBuffer: this.outputBuffer,
      onActivity: () => this.markActivity(),
      isActive: () => this.isActive,
    });
    if (this.shellKind === "powershell" || this.shellKind === "pwsh") {
      this.powershellScriptExecutor = new PowerShellScriptExecutor({
        terminal: this.terminal,
        shellKind: this.shellKind,
        outputBuffer: this.outputBuffer,
        onActivity: () => this.markActivity(),
        isActive: () => this.isActive,
      });
    }

    log(`Session ${this.sessionId} created: ${config.name} (cwd: ${this.cwd})`);
  }

  async execute(
    command: string,
    timeoutMs: number,
    waitForCompletion: boolean,
  ): Promise<TerminalExecutionResult> {
    log(
      `Executing command in session ${this.sessionId}: ${command.slice(0, 80)}`,
    );

    if (this.isBusy) {
      throw new Error(
        "Terminal session is busy. Wait for the current command to finish or use another session.",
      );
    }

    if (!waitForCompletion) {
      const commandId = generateCommandId();
      const startedAt = Date.now();
      this.markActivity(startedAt);

      // Mark the session busy so it won't be reused while the
      // fire-and-forget command is still running.  The caller
      // obtains a new terminal for their next command.
      this.shellIntegrationExecutor.markBusy();

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

    // cmd.exe: use file-based executor with PowerShell tee so output is
    // visible in the terminal in real-time AND reliably captured to a file.
    // Shell integration is not reliable enough for cmd on all VSCode versions.
    if (process.platform === "win32" && this.shellKind === "cmd") {
      return this.cmdScriptExecutor.execute(command, timeoutMs);
    }

    // For PowerShell / pwsh — use file-based Tee-Object executor that shows
    // output in real-time AND captures it reliably to a file.
    if (
      process.platform === "win32" &&
      (this.shellKind === "powershell" || this.shellKind === "pwsh") &&
      this.powershellScriptExecutor
    ) {
      return this.powershellScriptExecutor.execute(command, timeoutMs);
    }

    return this.shellIntegrationExecutor.execute(command, timeoutMs);
  }

  sendInput(input: string, pressEnter: boolean): void {
    this.terminal.sendText(input, pressEnter);
    this.markActivity();
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
    return (
      this.shellIntegrationExecutor.isBusy ||
      this.cmdScriptExecutor.isBusy ||
      Boolean(this.powershellScriptExecutor?.isBusy)
    );
  }

  getInfo(): TerminalSessionInfo {
    return {
      sessionId: this.sessionId,
      name: this.name,
      cwd: this.cwd,
      env: this.env,
      shell: this.shell,
      shellKind: this.shellKind,
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
    this.shellIntegrationExecutor.dispose();
    this.cmdScriptExecutor.dispose();
    this.powershellScriptExecutor?.dispose();
    this.terminal.dispose();
    log(`Session ${this.sessionId} disposed`);
  }

  private markActivity(timestamp = Date.now()): void {
    this.lastCommandAt = timestamp;
  }
}
