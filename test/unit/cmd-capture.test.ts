import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCmdCaptureCommand,
  createCmdCaptureFiles,
  readCaptureFile,
  writeCmdScript,
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
      "C:\\Temp\\command.cmd",
      "C:\\Temp\\stdout.txt",
      "C:\\Temp\\stderr.txt",
      "C:\\Temp\\exit-code.txt",
    );

    expect(command).toContain("chcp 65001");
    expect(command).toContain('call "C:\\Temp\\command.cmd"');
    expect(command).toContain('> "C:\\Temp\\stdout.txt"');
    expect(command).toContain('2> "C:\\Temp\\stderr.txt"');
    expect(command).toContain("call echo %^ERRORLEVEL%");
    expect(command).toContain('type "C:\\Temp\\stdout.txt"');
    expect(command).toContain('type "C:\\Temp\\stderr.txt" 1>&2');
    expect(command).toContain("call chcp %^BT_OLD_CP%");
  });

  it("creates capture files under one temp directory", () => {
    const files = createCmdCaptureFiles();
    cleanupDirs.push(files.captureDir);

    expect(files.stdoutPath).toBe(path.join(files.captureDir, "stdout.txt"));
    expect(files.stderrPath).toBe(path.join(files.captureDir, "stderr.txt"));
    expect(files.commandPath).toBe(path.join(files.captureDir, "command.cmd"));
    expect(files.exitCodePath).toBe(
      path.join(files.captureDir, "exit-code.txt"),
    );
  });

  it("writes multiline commands to a UTF-8 batch file", () => {
    const files = createCmdCaptureFiles();
    cleanupDirs.push(files.captureDir);

    writeCmdScript(files.commandPath, "echo one\necho 二");

    const content = fs.readFileSync(files.commandPath);
    expect(content.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(content.toString("utf8")).toContain(
      "@echo off\r\necho one\r\necho 二\r\n",
    );
  });

  it("reads missing capture files as empty output", () => {
    expect(readCaptureFile("C:\\definitely\\missing\\bashterm.txt")).toBe("");
  });

  it("reads capture files with shell-aware decoding", () => {
    const files = createCmdCaptureFiles();
    cleanupDirs.push(files.captureDir);
    fs.writeFileSync(files.stdoutPath, Buffer.from("hello", "utf8"));

    expect(readCaptureFile(files.stdoutPath)).toBe("hello");
  });
});
