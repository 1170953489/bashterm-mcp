import { describe, it, expect, afterEach } from "vitest";
import { isCmdShell, resolveDefaultShell, resolveShell } from "../../src/utils/shell.js";

const originalComspec = process.env.COMSPEC;
const originalSystemRoot = process.env.SystemRoot;

afterEach(() => {
  restoreEnv("COMSPEC", originalComspec);
  restoreEnv("SystemRoot", originalSystemRoot);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("shell utilities", () => {
  it("returns undefined as the default shell outside Windows", () => {
    expect(resolveDefaultShell("linux")).toBeUndefined();
    expect(resolveDefaultShell("darwin")).toBeUndefined();
  });

  it("uses COMSPEC as the Windows default shell when available", () => {
    process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";

    expect(resolveDefaultShell("win32")).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("falls back to SystemRoot cmd.exe when COMSPEC is missing", () => {
    delete process.env.COMSPEC;
    process.env.SystemRoot = "D:\\Windows";

    expect(resolveDefaultShell("win32")).toBe("D:\\Windows\\System32\\cmd.exe");
  });

  it("keeps caller-provided shells unchanged", () => {
    expect(resolveShell("/bin/zsh")).toBe("/bin/zsh");
  });

  it("detects cmd.exe shell paths", () => {
    expect(isCmdShell("C:\\Windows\\System32\\cmd.exe")).toBe(true);
    expect(isCmdShell("cmd")).toBe(true);
    expect(isCmdShell("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe(false);
  });
});
