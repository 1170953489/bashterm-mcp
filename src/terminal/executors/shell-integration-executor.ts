import * as vscode from "vscode";
import type { CommandExecution, OutputBuffer } from "../../types/index.js";
import { appendToBuffer } from "../output-capture.js";
import { generateCommandId } from "../../utils/id-generator.js";
import { log, logError } from "../../utils/logger.js";
import type {
  TerminalCommandExecutor,
  TerminalExecutionResult,
} from "./types.js";

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

interface ShellIntegrationExecutorOptions {
  sessionId: string;
  terminal: vscode.Terminal;
  outputBuffer: OutputBuffer;
  onActivity: () => void;
  onShellReady: () => void;
}

const SHELL_INTEGRATION_START_TIMEOUT_MS = 3000;

export class ShellIntegrationExecutor implements TerminalCommandExecutor {
  private readonly sessionId: string;
  private readonly terminal: vscode.Terminal;
  private readonly outputBuffer: OutputBuffer;
  private readonly onActivity: () => void;
  private readonly onShellReady: () => void;
  private readonly commandHistory: CommandExecution[] = [];
  private currentCommand: CommandExecution | null = null;
  private pendingExecution: PendingTerminalExecution | null = null;
  private shellExecutionDisposable: vscode.Disposable | null = null;
  private shellExecutionEndDisposable: vscode.Disposable | null = null;
  private _fireAndForgetBusy = false;

  constructor(options: ShellIntegrationExecutorOptions) {
    this.sessionId = options.sessionId;
    this.terminal = options.terminal;
    this.outputBuffer = options.outputBuffer;
    this.onActivity = options.onActivity;
    this.onShellReady = options.onShellReady;
    this.setupCapture();
  }

  get isBusy(): boolean {
    return this.currentCommand !== null || this._fireAndForgetBusy;
  }

  /** Mark the executor busy for fire-and-forget commands. */
  markBusy(): void {
    this._fireAndForgetBusy = true;
  }

  async execute(
    command: string,
    timeoutMs: number,
  ): Promise<TerminalExecutionResult> {
    const commandId = generateCommandId();
    const startedAt = Date.now();
    this.onActivity();

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
      delay(timeoutMs).then(() => this.resolveTimeout(pending)),
    ]);
  }

  dispose(): void {
    this.shellExecutionDisposable?.dispose();
    this.shellExecutionEndDisposable?.dispose();
  }

  private setupCapture(): void {
    if (vscode.window.onDidStartTerminalShellExecution) {
      this.shellExecutionDisposable =
        vscode.window.onDidStartTerminalShellExecution(async (event) => {
          if (event.terminal !== this.terminal) return;

          log(
            `Shell execution started in session ${this.sessionId}: ${event.execution.commandLine?.value ?? "unknown"}`,
          );

          this.onShellReady();

          const pending = this.pendingExecution;
          if (pending && !pending.started) {
            pending.started = true;
            pending.startedResolve();
          }

          try {
            const stream = event.execution.read();
            for await (const chunk of stream) {
              appendToBuffer(this.outputBuffer, chunk);
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
              this.tryComplete(pending);
            }
          }
        });

      if (vscode.window.onDidEndTerminalShellExecution) {
        this.shellExecutionEndDisposable =
          vscode.window.onDidEndTerminalShellExecution((event) => {
            if (event.terminal !== this.terminal) return;

            // Clear the fire-and-forget busy marker when any shell
            // execution ends, so the terminal becomes reusable again.
            this._fireAndForgetBusy = false;

            const pending = this.pendingExecution;
            if (pending && pending.started && !pending.ended) {
              pending.ended = true;
              pending.exitCode = event.exitCode ?? null;
              this.tryComplete(pending);
            }

            this.onActivity();

            log(
              `Shell execution ended in session ${this.sessionId} with exit code: ${event.exitCode}`,
            );
          });
      }
    }
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

  private tryComplete(pending: PendingTerminalExecution): void {
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

  private resolveTimeout(
    pending: PendingTerminalExecution,
  ): TerminalExecutionResult {
    pending.timedOut = true;
    pending.command.timedOut = true;
    pending.command.completedAt = Date.now();
    pending.command.exitCode = undefined;
    pending.command.outputEndLine = this.outputBuffer.lines.length;

    if (!pending.resultResolved) {
      pending.resultResolved = true;
    }

    // Clean up executor state so the session becomes reusable again.
    this.commandHistory.push(pending.command);
    if (this.pendingExecution === pending) {
      this.pendingExecution = null;
    }
    if (this.currentCommand === pending.command) {
      this.currentCommand = null;
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
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
