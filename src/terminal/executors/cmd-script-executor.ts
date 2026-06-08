import * as fs from "fs";
import * as vscode from "vscode";
import type { CommandExecution, OutputBuffer } from "../../types/index.js";
import { generateCommandId } from "../../utils/id-generator.js";
import { appendToBuffer } from "../output-capture.js";
import {
  buildCmdCaptureCommand,
  createCmdCaptureFiles,
  readCaptureFile,
  writeCmdScript,
  writeWrapperScript,
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
const CMD_OUTPUT_FLUSH_DELAY_MS = 200;

/**
 * Executes commands in a cmd.exe terminal using file-based capture.
 *
 * This executor is fully self-sufficient — it does NOT depend on VSCode
 * shell integration.  A wrapper batch file is generated that:
 *
 * 1. Saves and switches the console code page to UTF-8
 * 2. Runs the user's commands, redirecting stdout+stderr to a capture file
 * 3. Persists the exit code to a second file
 * 4. Restores the original code page
 * 5. Types the captured output so it still renders in the VSCode terminal
 *
 * The executor polls for the exit-code file to appear and then reads
 * output from the capture file directly, bypassing shell integration.
 */
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

    const files = createCmdCaptureFiles();
    writeCmdScript(files.commandPath, command);
    writeWrapperScript(
      files.wrapperPath,
      files.commandPath,
      files.outputPath,
      files.exitCodePath,
    );
    const wrappedCommand = buildCmdCaptureCommand(files.wrapperPath);

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

    // Give the wrapper a short grace period to flush the output file
    // (type command may still be writing when the exit-code file appeared).
    await delay(CMD_OUTPUT_FLUSH_DELAY_MS);

    if (timedOut) {
      const partialOutput = this.readOutputFromFile(files);
      if (partialOutput) {
        appendToBuffer(this.outputBuffer, partialOutput);
      }
      void this.finalizeWhenReady(commandExecution, files);
      return {
        commandId,
        output: partialOutput,
        exitCode: null,
        timedOut: true,
        durationMs: Date.now() - startedAt,
      };
    }

    const exitCode = this.readExitCode(files.exitCodePath);
    const output = this.readOutputFromFile(files);
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
  ): Promise<void> {
    await waitForFile(files.exitCodePath, () => !this.isActiveSession());
    if (!this.isActiveSession() || !fs.existsSync(files.exitCodePath)) return;

    const output = this.readOutputFromFile(files);
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

    // Append captured output to the shared buffer so the read tool can access it
    if (output) {
      appendToBuffer(this.outputBuffer, output);
    }
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

  /**
   * Read command output from the capture file.
   *
   * When shell integration is available the shared output buffer may also
   * contain the output (because the "type" command triggers shell
   * integration events).  We prefer the file because it is authoritative
   * and works even without shell integration.
   */
  private readOutputFromFile(files: CmdCaptureFiles): string {
    const raw = readCaptureFile(files.outputPath);
    // cmd.exe "type" appends a trailing newline and the wrapper itself
    // may leave an extra line.  Trim but preserve inner blank lines.
    return raw.trim();
  }

  private readExitCode(exitCodePath: string): number | null {
    const exitCodeText = readCaptureFile(exitCodePath).trim();
    // The file may contain leading/trailing whitespace or extra lines from
    // command echo — extract the first integer found.
    const match = exitCodeText.match(/-?\d+/);
    if (!match) return null;
    const exitCode = Number.parseInt(match[0], 10);
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
