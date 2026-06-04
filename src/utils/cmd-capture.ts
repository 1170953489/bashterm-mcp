import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TextDecoder } from "util";
import { detectShellEncoding } from "./exec-options.js";

export interface CmdCaptureFiles {
  captureDir: string;
  stdoutPath: string;
  stderrPath: string;
  exitCodePath: string;
}

export function createCmdCaptureFiles(): CmdCaptureFiles {
  const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), "bashterm-mcp-"));
  return {
    captureDir,
    stdoutPath: path.join(captureDir, "stdout.txt"),
    stderrPath: path.join(captureDir, "stderr.txt"),
    exitCodePath: path.join(captureDir, "exit-code.txt"),
  };
}

export function buildCmdCaptureCommand(
  command: string,
  stdoutPath: string,
  stderrPath: string,
  exitCodePath: string,
): string {
  const stdout = quoteCmdPath(stdoutPath);
  const stderr = quoteCmdPath(stderrPath);
  const exitCode = quoteCmdPath(exitCodePath);

  return `(${command}) > ${stdout} 2> ${stderr} & call echo %^ERRORLEVEL% > ${exitCode} & type ${stdout} & type ${stderr} 1>&2`;
}

export function readCaptureFile(filePath: string, shell?: string): string {
  if (!fs.existsSync(filePath)) return "";

  const bytes = fs.readFileSync(filePath);
  const encoding = detectShellEncoding(process.platform === "win32", shell);
  return new TextDecoder(encoding).decode(bytes);
}

function quoteCmdPath(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
