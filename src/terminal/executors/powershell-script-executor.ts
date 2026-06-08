import * as fs from "fs";
import * as vscode from "vscode";
import type { CommandExecution, OutputBuffer } from "../../types/index.js";
import { generateCommandId } from "../../utils/id-generator.js";
import { appendToBuffer } from "../output-capture.js";
import {
  buildPowerShellCaptureCommand,
  createPowerShellCaptureFiles,
  readPowerShellCaptureFile,
  writePowerShellScript,
  writePowerShellWrapperScript,
  type PowerShellCaptureFiles,
} from "../../utils/powershell-capture.js";
import type {
  TerminalCommandExecutor,
  TerminalExecutionResult,
} from "./types.js";

interface PowerShellScriptExecutorOptions {
  terminal: vscode.Terminal;
  shellKind: "powershell" | "pwsh";
  outputBuffer: OutputBuffer;
  onActivity: () => void;
  isActive: () => boolean;
}

const CAPTURE_POLL_INTERVAL_MS = 100;
const POWERSHELL_OUTPUT_FLUSH_DELAY_MS = 200;

export class PowerShellScriptExecutor implements TerminalCommandExecutor {
  private readonly terminal: vscode.Terminal;
  private readonly shellKind: "powershell" | "pwsh";
  private readonly outputBuffer: OutputBuffer;
  private readonly onActivity: () => void;
  private readonly isActiveSession: () => boolean;
  private readonly commandHistory: CommandExecution[] = [];
  private currentCommand: CommandExecution | null = null;

  constructor(options: PowerShellScriptExecutorOptions) {
    this.terminal = options.terminal;
    this.shellKind = options.shellKind;
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

    const files = createPowerShellCaptureFiles();
    writePowerShellScript(files.commandPath, command);
    writePowerShellWrapperScript(
      files.wrapperPath,
      files.commandPath,
      files.outputPath,
      files.exitCodePath,
    );
    const wrappedCommand = buildPowerShellCaptureCommand(
      files.wrapperPath,
      this.shellKind,
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

    await delay(POWERSHELL_OUTPUT_FLUSH_DELAY_MS);

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
    files: PowerShellCaptureFiles,
  ): Promise<void> {
    await waitForFile(files.exitCodePath, () => !this.isActiveSession());
    if (!this.isActiveSession() || !fs.existsSync(files.exitCodePath)) return;

    const exitCode = this.readExitCode(files.exitCodePath);
    const output = this.readOutputFromFile(files);
    this.finalize(commandExecution, files, exitCode, output);
  }

  private finalize(
    commandExecution: CommandExecution,
    files: PowerShellCaptureFiles,
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

  private readOutputFromFile(files: PowerShellCaptureFiles): string {
    return readPowerShellCaptureFile(files.outputPath).trim();
  }

  private readExitCode(exitCodePath: string): number | null {
    const exitCodeText = readPowerShellCaptureFile(exitCodePath).trim();
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
