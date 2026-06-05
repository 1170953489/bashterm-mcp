import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPowerShellCaptureCommand,
  createPowerShellCaptureFiles,
  readPowerShellCaptureFile,
  writePowerShellScript,
  writePowerShellWrapperScript,
} from "../../src/utils/powershell-capture.js";

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("PowerShell capture utilities", () => {
  it("creates capture files under one temp directory", () => {
    const files = createPowerShellCaptureFiles();
    cleanupDirs.push(files.captureDir);

    expect(files.commandPath).toBe(path.join(files.captureDir, "command.ps1"));
    expect(files.wrapperPath).toBe(path.join(files.captureDir, "wrapper.ps1"));
    expect(files.exitCodePath).toBe(
      path.join(files.captureDir, "exit-code.txt"),
    );
    expect(files.outputPath).toBe(path.join(files.captureDir, "output.txt"));
  });

  it("writes user commands to a PowerShell script with UTF-8 BOM", () => {
    const files = createPowerShellCaptureFiles();
    cleanupDirs.push(files.captureDir);

    writePowerShellScript(files.commandPath, "Write-Output hello\nexit 3");

    const raw = fs.readFileSync(files.commandPath);
    // BOM should be present
    expect(raw[0]).toBe(0xef);
    expect(raw[1]).toBe(0xbb);
    expect(raw[2]).toBe(0xbf);
    const content = raw.subarray(3).toString("utf8");
    expect(content).toBe("Write-Output hello\r\nexit 3\r\n");
  });

  it("writes a wrapper script that captures output and exit code", () => {
    const files = createPowerShellCaptureFiles();
    cleanupDirs.push(files.captureDir);

    writePowerShellWrapperScript(
      files.wrapperPath,
      files.commandPath,
      files.outputPath,
      files.exitCodePath,
    );

    const raw = fs.readFileSync(files.wrapperPath);
    // BOM
    expect(raw[0]).toBe(0xef);
    expect(raw[1]).toBe(0xbb);
    expect(raw[2]).toBe(0xbf);
    const content = raw.subarray(3).toString("utf8");
    expect(content).toContain("[Console]::OutputEncoding");
    expect(content).toContain("Tee-Object -FilePath $btOutputPath");
    expect(content).toContain("Set-Content -LiteralPath $btExitCodePath");
    expect(content).toContain("exit $btExitCode");
  });

  it("builds PowerShell launcher commands", () => {
    expect(
      buildPowerShellCaptureCommand("C:\\Temp\\wrapper.ps1", "powershell"),
    ).toBe(
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\Temp\\wrapper.ps1"',
    );
    expect(buildPowerShellCaptureCommand("C:\\Temp\\wrapper.ps1", "pwsh")).toBe(
      'pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\Temp\\wrapper.ps1"',
    );
  });

  it("reads missing capture files as empty string", () => {
    expect(readPowerShellCaptureFile("C:\\missing\\bashterm.txt")).toBe("");
  });

  it("reads capture files with UTF-8 decoding", () => {
    const files = createPowerShellCaptureFiles();
    cleanupDirs.push(files.captureDir);

    fs.writeFileSync(files.outputPath, Buffer.from("hello\nworld", "utf8"));

    expect(readPowerShellCaptureFile(files.outputPath)).toBe("hello\nworld");
  });

  it("reads capture files with UTF-16LE BOM (PowerShell 5.1 default)", () => {
    const files = createPowerShellCaptureFiles();
    cleanupDirs.push(files.captureDir);

    // Simulate PowerShell 5.1 Tee-Object output: UTF-16LE with BOM
    const bom = Buffer.from([0xff, 0xfe]);
    const utf16Content = Buffer.from("hello\nworld", "utf16le");
    fs.writeFileSync(files.outputPath, Buffer.concat([bom, utf16Content]));

    expect(readPowerShellCaptureFile(files.outputPath)).toBe("hello\nworld");
  });

  it("reads capture files with UTF-16LE BOM containing CJK characters", () => {
    const files = createPowerShellCaptureFiles();
    cleanupDirs.push(files.captureDir);

    const bom = Buffer.from([0xff, 0xfe]);
    const utf16Content = Buffer.from("你好世界！🎉", "utf16le");
    fs.writeFileSync(files.outputPath, Buffer.concat([bom, utf16Content]));

    expect(readPowerShellCaptureFile(files.outputPath)).toBe("你好世界！🎉");
  });
});
