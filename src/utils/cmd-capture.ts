import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TextDecoder } from "util";

export interface CmdCaptureFiles {
  captureDir: string;
  /** Batch file containing only the user's raw commands. */
  commandPath: string;
  /** PowerShell wrapper that runs the command via cmd /c with Tee-Object. */
  wrapperPath: string;
  exitCodePath: string;
  outputPath: string;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function writeFileUtf8Bom(filePath: string, content: string): void {
  const body = Buffer.from(content, "utf8");
  fs.writeFileSync(filePath, Buffer.concat([UTF8_BOM, body]));
}

export function createCmdCaptureFiles(): CmdCaptureFiles {
  const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), "bashterm-mcp-"));
  return {
    captureDir,
    commandPath: path.join(captureDir, "command.cmd"),
    wrapperPath: path.join(captureDir, "wrapper.ps1"),
    exitCodePath: path.join(captureDir, "exit-code.txt"),
    outputPath: path.join(captureDir, "output.txt"),
  };
}

/**
 * Write the user's raw command(s) into a batch file.
 * Written with UTF-8 BOM so cmd.exe correctly interprets non-ASCII characters.
 */
export function writeCmdScript(filePath: string, command: string): void {
  writeFileUtf8Bom(filePath, normalizeBatchBody(command));
}

/**
 * Write a PowerShell wrapper script that:
 * 1. Saves and switches the console code page to UTF-8
 * 2. Runs the user's cmd command via `cmd /c` piped through `Tee-Object`
 *    — output is visible in the terminal in real-time AND captured to a file.
 * 3. Saves the exit code to a separate file
 * 4. Restores the original code page
 *
 * This replaces the old batch-file wrapper whose `>` redirect hid all output
 * until the command completed, violating the "Visible by default" design goal.
 */
export function writeWrapperScript(
  wrapperPath: string,
  commandPath: string,
  outputPath: string,
  exitCodePath: string,
): void {
  const script = [
    "$ErrorActionPreference = 'Continue'",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "",
    "$btOutputPath = " + quotePowerShellString(outputPath),
    "$btExitCodePath = " + quotePowerShellString(exitCodePath),
    "$btCommandPath = " + quotePowerShellString(commandPath),
    "$btEsc = [char]27",
    "[Console]::Write(\"${btEsc}[1A${btEsc}[2K`r\")",
    "",
    "Remove-Item -LiteralPath $btOutputPath -Force -ErrorAction SilentlyContinue",
    "Remove-Item -LiteralPath $btExitCodePath -Force -ErrorAction SilentlyContinue",
    "",
    "$btExitCode = 0",
    "try {",
    "  cmd /c \"call `\"$btCommandPath`\" 2>&1\" | Tee-Object -FilePath $btOutputPath",
    "  if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) {",
    "    $btExitCode = $LASTEXITCODE",
    "  } elseif (-not $?) {",
    "    $btExitCode = 1",
    "  }",
    "} catch {",
    "  $_ | Out-String | Tee-Object -FilePath $btOutputPath -Append",
    "  $btExitCode = 1",
    "} finally {",
    "  Set-Content -LiteralPath $btExitCodePath -Value $btExitCode -Encoding utf8",
    "}",
    "exit $btExitCode",
  ].join("\r\n");

  writeFileUtf8Bom(wrapperPath, script + "\r\n");
}

/** Build the shell command to run the wrapper in the terminal.
 *
 * The wrapper clears this transient launcher line before running the user's
 * cmd script, keeping the visible terminal focused on the real command output.
 */
export function buildCmdCaptureCommand(wrapperPath: string): string {
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${quotePowerShellArgument(wrapperPath)}`;
}

export function readCaptureFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";

  const bytes = fs.readFileSync(filePath);

  // Detect BOM: PowerShell 5.1 Tee-Object writes UTF-16LE with BOM.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }

  return new TextDecoder("utf-8").decode(bytes);
}

function normalizeBatchBody(command: string): string {
  let body = command
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\r\n");
  // Ensure the batch file ends with a trailing CRLF — cmd.exe expects it.
  if (!body.endsWith("\r\n")) {
    body += "\r\n";
  }
  return body;
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quotePowerShellArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
