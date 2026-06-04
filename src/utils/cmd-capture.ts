import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TextDecoder } from "util";

export interface CmdCaptureFiles {
  captureDir: string;
  commandPath: string;
  stdoutPath: string;
  stderrPath: string;
  exitCodePath: string;
}

export function createCmdCaptureFiles(): CmdCaptureFiles {
  const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), "bashterm-mcp-"));
  return {
    captureDir,
    commandPath: path.join(captureDir, "command.cmd"),
    stdoutPath: path.join(captureDir, "stdout.txt"),
    stderrPath: path.join(captureDir, "stderr.txt"),
    exitCodePath: path.join(captureDir, "exit-code.txt"),
  };
}

export function writeCmdScript(filePath: string, command: string): void {
  const script = `@echo off\r\n${normalizeBatchBody(command)}\r\n`;
  fs.writeFileSync(filePath, Buffer.from("\uFEFF" + script, "utf8"));
}

export function buildCmdCaptureCommand(
  commandPath: string,
  stdoutPath: string,
  stderrPath: string,
  exitCodePath: string,
): string {
  const commandFile = quoteCmdPath(commandPath);
  const stdout = quoteCmdPath(stdoutPath);
  const stderr = quoteCmdPath(stderrPath);
  const exitCode = quoteCmdPath(exitCodePath);

  return `for /f "tokens=2 delims=:" %A in ('chcp') do @set "BT_OLD_CP=%A" & chcp 65001 > nul & call ${commandFile} > ${stdout} 2> ${stderr} & call echo %^ERRORLEVEL% > ${exitCode} & type ${stdout} & type ${stderr} 1>&2 & call chcp %^BT_OLD_CP% > nul`;
}

export function readCaptureFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";

  const bytes = fs.readFileSync(filePath);
  return new TextDecoder("utf-8").decode(bytes);
}

function quoteCmdPath(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function normalizeBatchBody(command: string): string {
  return command
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\r\n");
}
