import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCmdCaptureCommand,
  createCmdCaptureFiles,
  readCaptureFile,
} from "../../src/utils/cmd-capture.js";

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("cmd capture utilities", () => {
  it("builds a cmd wrapper that captures stdout, stderr, and exit code", () => {
    const command = buildCmdCaptureCommand(
      'echo "stdout" && echo "stderr" 1>&2',
      "C:\\Temp\\stdout.txt",
      "C:\\Temp\\stderr.txt",
      "C:\\Temp\\exit-code.txt",
    );

    expect(command).toContain('(echo "stdout" && echo "stderr" 1>&2)');
    expect(command).toContain('> "C:\\Temp\\stdout.txt"');
    expect(command).toContain('2> "C:\\Temp\\stderr.txt"');
    expect(command).toContain("call echo %^ERRORLEVEL%");
    expect(command).toContain('type "C:\\Temp\\stdout.txt"');
    expect(command).toContain('type "C:\\Temp\\stderr.txt" 1>&2');
  });

  it("creates capture files under one temp directory", () => {
    const files = createCmdCaptureFiles();
    cleanupDirs.push(files.captureDir);

    expect(files.stdoutPath).toBe(path.join(files.captureDir, "stdout.txt"));
    expect(files.stderrPath).toBe(path.join(files.captureDir, "stderr.txt"));
    expect(files.exitCodePath).toBe(
      path.join(files.captureDir, "exit-code.txt"),
    );
  });

  it("reads missing capture files as empty output", () => {
    expect(readCaptureFile("C:\\definitely\\missing\\bashterm.txt")).toBe("");
  });

  it("reads capture files with shell-aware decoding", () => {
    const files = createCmdCaptureFiles();
    cleanupDirs.push(files.captureDir);
    fs.writeFileSync(files.stdoutPath, Buffer.from("hello", "utf8"));

    expect(
      readCaptureFile(files.stdoutPath, "C:\\Windows\\System32\\cmd.exe"),
    ).toBe("hello");
  });
});
