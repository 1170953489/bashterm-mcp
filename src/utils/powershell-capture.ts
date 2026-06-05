import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TextDecoder } from "util";

export interface PowerShellCaptureFiles {
  captureDir: string;
  commandPath: string;
  wrapperPath: string;
  exitCodePath: string;
  outputPath: string;
}

export function createPowerShellCaptureFiles(): PowerShellCaptureFiles {
  const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), "bashterm-mcp-"));
  return {
    captureDir,
    commandPath: path.join(captureDir, "command.ps1"),
    wrapperPath: path.join(captureDir, "wrapper.ps1"),
    exitCodePath: path.join(captureDir, "exit-code.txt"),
    outputPath: path.join(captureDir, "output.txt"),
  };
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function writeFileUtf8Bom(filePath: string, content: string): void {
  const body = Buffer.from(content, "utf8");
  fs.writeFileSync(filePath, Buffer.concat([UTF8_BOM, body]));
}

export function writePowerShellScript(filePath: string, command: string): void {
  writeFileUtf8Bom(filePath, normalizeScriptBody(command));
}

export function writePowerShellWrapperScript(
  wrapperPath: string,
  commandPath: string,
  outputPath: string,
  exitCodePath: string,
): void {
  const script = [
    "$ErrorActionPreference = 'Continue'",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    `$btOutputPath = ${quotePowerShellString(outputPath)}`,
    `$btExitCodePath = ${quotePowerShellString(exitCodePath)}`,
    `$btCommandPath = ${quotePowerShellString(commandPath)}`,
    "Remove-Item -LiteralPath $btOutputPath -Force -ErrorAction SilentlyContinue",
    "Remove-Item -LiteralPath $btExitCodePath -Force -ErrorAction SilentlyContinue",
    "$btExitCode = 0",
    "try {",
    "  & $btCommandPath *>&1 | Tee-Object -FilePath $btOutputPath",
    "  if ($LASTEXITCODE -is [int]) {",
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

export function buildPowerShellCaptureCommand(
  wrapperPath: string,
  shellKind: "powershell" | "pwsh",
): string {
  const launcher = shellKind === "pwsh" ? "pwsh.exe" : "powershell.exe";
  return `${launcher} -NoProfile -ExecutionPolicy Bypass -File ${quotePowerShellArgument(wrapperPath)}`;
}

export function readPowerShellCaptureFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";

  const bytes = fs.readFileSync(filePath);

  // Detect BOM to handle PowerShell 5.1's UTF-16LE default output encoding.
  // Windows PowerShell 5.1 Tee-Object / Out-File writes UTF-16LE with BOM;
  // PowerShell 7+ may write UTF-8. The BOM check handles both correctly.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    // UTF-16LE BOM: skip BOM (first 2 bytes)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }

  return new TextDecoder("utf-8").decode(bytes);
}

function normalizeScriptBody(command: string): string {
  let body = command.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!body.endsWith("\n")) {
    body += "\n";
  }
  return body.replace(/\n/g, "\r\n");
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quotePowerShellArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
