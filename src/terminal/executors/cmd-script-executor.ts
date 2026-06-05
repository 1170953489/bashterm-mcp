import * as fs from "fs";
import * as vscode from "vscode";
import type { CommandExecution, OutputBuffer } from "../../types/index.js";
import { generateCommandId } from "../../utils/id-generator.js";
import {
  buildCmdCaptureCommand,
  createCmdCaptureFiles,
  readCaptureFile,
  writeCmdScript,
  type CmdCaptureFiles,
} from "../../utils/cmd-capture.js";
import type {
  TerminalCommandExecutor,
  TerminalExecutionResult,
} from "./types.js";

interface CmdScriptExecutorOptions {
  terminal: vscode.Terminal;
  outputBuffer: OutputBuffer;
  onActivity: () => void;
  isActive: () => boolean;
}

const CAPTURE_POLL_INTERVAL_MS = 100;
const CMD_OUTPUT_FLUSH_DELAY_MS = 100;

export class CmdScriptExecutor implements TerminalCommandExecutor {
  private readonly terminal: vscode.Terminal;
  private readonly outputBuffer: OutputBuffer;
  private readonly onActivity: () => void;
  private readonly isActiveSession: () => boolean;
  private readonly commandHistory: CommandExecution[] = [];
  private currentCommand: CommandExecution | null = null;

  constructor(options: CmdScriptExecutorOptions) {
    this.terminal = options.terminal;
    this.outputBuffer = options.outputBuffer;
    this.onActivity = options.onActivity;
    this.isActiveSession = options.isActive;
  }

  get isBusy(): boolean {
    return this.currentCommand !== null;
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
    this.currentCommand = commandExecution;
    const outputStartIndex = this.outputBuffer.lines.length;

    const files = createCmdCaptureFiles();
    writeCmdScript(files.commandPath, command);
    const wrappedCommand = buildCmdCaptureCommand(
      files.commandPath,
      files.exitCodePath,
    );

    this.terminal.show(true);
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

    await delay(CMD_OUTPUT_FLUSH_DELAY_MS);
    const output = this.readBufferedOutputFrom(outputStartIndex);

    if (timedOut) {
      void this.finalizeWhenReady(commandExecution, files, outputStartIndex);
      return {
        commandId,
        output,
        exitCode: null,
        timedOut: true,
        durationMs: Date.now() - startedAt,
      };
    }

    const exitCode = this.readExitCode(files.exitCodePath);
    this.finalize(commandExecution, files, exitCode, output);

    return {
      commandId,
      output,
      exitCode,
      timedOut,
      durationMs: Date.now() - startedAt,
    };
  }

  dispose(): void {
    this.currentCommand = null;
  }

  private async finalizeWhenReady(
    commandExecution: CommandExecution,
    files: CmdCaptureFiles,
    outputStartIndex: number,
  ): Promise<void> {
    await waitForFile(files.exitCodePath, () => !this.isActiveSession());
    if (!this.isActiveSession() || !fs.existsSync(files.exitCodePath)) return;

    const output = this.readBufferedOutputFrom(outputStartIndex);
    const exitCode = this.readExitCode(files.exitCodePath);
    this.finalize(commandExecution, files, exitCode, output);
  }

  private finalize(
    commandExecution: CommandExecution,
    files: CmdCaptureFiles,
    exitCode: number | null,
    output: string,
  ): void {
    commandExecution.completedAt = Date.now();
    commandExecution.exitCode = exitCode ?? undefined;
    commandExecution.outputEndLine = this.outputBuffer.lines.length;
    this.commandHistory.push(commandExecution);

    if (this.currentCommand === commandExecution) {
      this.currentCommand = null;
    }

    try {
      fs.rmSync(files.captureDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures; files are in the OS temp directory.
    }
  }

  private readBufferedOutputFrom(outputStartIndex: number): string {
    return this.outputBuffer.lines.slice(outputStartIndex).join("\n").trim();
  }

  private readExitCode(exitCodePath: string): number | null {
    const exitCodeText = readCaptureFile(exitCodePath).trim();
    const exitCode = Number.parseInt(exitCodeText, 10);
    return Number.isFinite(exitCode) ? exitCode : null;
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
