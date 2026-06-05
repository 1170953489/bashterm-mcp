import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCmdCaptureCommand,
  createCmdCaptureFiles,
  readCaptureFile,
  writeCmdScript,
  writeWrapperScript,
} from "../../src/utils/cmd-capture.js";

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("cmd capture utilities", () => {
  it("creates capture files under one temp directory", () => {
    const files = createCmdCaptureFiles();
    cleanupDirs.push(files.captureDir);

    expect(files.commandPath).toBe(path.join(files.captureDir, "command.cmd"));
    expect(files.wrapperPath).toBe(path.join(files.captureDir, "wrapper.ps1"));
    expect(files.exitCodePath).toBe(
      path.join(files.captureDir, "exit-code.txt"),
    );
    expect(files.outputPath).toBe(path.join(files.captureDir, "output.txt"));
  });

  it("writes user commands to a batch file with UTF-8 BOM", () => {
    const files = createCmdCaptureFiles();
    cleanupDirs.push(files.captureDir);

    writeCmdScript(files.commandPath, "echo one\necho 二");

    const raw = fs.readFileSync(files.commandPath);
    // UTF-8 BOM
    expect(raw[0]).toBe(0xef);
    expect(raw[1]).toBe(0xbb);
    expect(raw[2]).toBe(0xbf);
    const content = raw.subarray(3).toString("utf8");
    expect(content).toContain("echo one\r\necho 二\r\n");
    expect(content).not.toContain("@echo off");
  });

  it("writes a PowerShell wrapper that tees cmd output (visible + captured)", () => {
    const files = createCmdCaptureFiles();
    cleanupDirs.push(files.captureDir);

    writeWrapperScript(
      files.wrapperPath,
      files.commandPath,
      files.outputPath,
      files.exitCodePath,
    );

    const raw = fs.readFileSync(files.wrapperPath);
    // UTF-8 BOM
    expect(raw[0]).toBe(0xef);
    expect(raw[1]).toBe(0xbb);
    expect(raw[2]).toBe(0xbf);
    const content = raw.subarray(3).toString("utf8");

    // PowerShell wrapper, not batch
    expect(content).toContain("$ErrorActionPreference");
    // Runs cmd /c through Tee-Object for real-time visibility
    expect(content).toContain("Tee-Object -FilePath $btOutputPath");
    expect(content).toContain("cmd /c");
    expect(content).toContain("$btCommandPath");
    // Clears the transient PowerShell launcher line from the visible terminal.
    expect(content).toContain("[Console]::Write");
    expect(content).toContain("${btEsc}[1A${btEsc}[2K`r");
    // Saves exit code
    expect(content).toContain("Set-Content -LiteralPath $btExitCodePath");
    expect(content).toContain("$btExitCode");
  });

  it("builds a PowerShell launcher command", () => {
    const command = buildCmdCaptureCommand("C:\\Temp\\wrapper.ps1");

    expect(command).toContain("powershell.exe");
    expect(command).not.toContain("@echo off");
    expect(command).not.toContain("& echo on");
    expect(command).toContain("-NoProfile");
    expect(command).toContain("-ExecutionPolicy Bypass");
    expect(command).toContain("-File");
    expect(command).toContain("wrapper.ps1");
  });

  it("reads missing capture files as empty string", () => {
    expect(readCaptureFile("C:\\definitely\\missing\\bashterm.txt")).toBe("");
  });

  it("reads capture files with UTF-8 decoding", () => {
    const files = createCmdCaptureFiles();
    cleanupDirs.push(files.captureDir);

    fs.writeFileSync(files.outputPath, Buffer.from("hello\nworld", "utf8"));

    expect(readCaptureFile(files.outputPath)).toBe("hello\nworld");
  });

  it("reads capture files with UTF-16LE BOM (PowerShell Tee-Object output)", () => {
    const files = createCmdCaptureFiles();
    cleanupDirs.push(files.captureDir);

    const bom = Buffer.from([0xff, 0xfe]);
    const utf16Content = Buffer.from("hello\nworld", "utf16le");
    fs.writeFileSync(files.outputPath, Buffer.concat([bom, utf16Content]));

    expect(readCaptureFile(files.outputPath)).toBe("hello\nworld");
  });
});
