import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { isCmdShell, resolvePowerShellPath } from "../../src/utils/shell.js";
import {
  analyzeWindowsCommandSyntax,
  planWindowsCommand,
  resolveWindowsShell,
} from "../../src/utils/windows-command-planner.js";

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

describe("Windows V2 command planner", () => {
  it("detects cmd shell paths", () => {
    expect(isCmdShell("C:\\Windows\\System32\\cmd.exe")).toBe(true);
    expect(isCmdShell("cmd")).toBe(true);
    expect(
      isCmdShell(
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ),
    ).toBe(false);
  });

  it("defaults ordinary commands to cmd", () => {
    process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";

    const plan = planWindowsCommand({
      platform: "win32",
      command: "git status",
    });

    expect(plan.shellKind).toBe("cmd");
    expect(plan.shellPath).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(plan.executionMode).toBe("script");
    expect(plan.captureMode).toBe("cmdExitFile");
    expect(plan.command).toBe("git status");
  });

  it("plans npm test as cmd instead of VSCode default", () => {
    const plan = planWindowsCommand({
      platform: "win32",
      command: "npm test",
    });

    expect(plan.shellKind).toBe("cmd");
    expect(plan.reason).toContain("default cmd");
  });

  it("rewrites leading cd with command chaining into cwd plus command", () => {
    const plan = planWindowsCommand({
      platform: "win32",
      command: "cd C:/repo && git diff --stat",
    });

    expect(plan.cwd).toBe(path.resolve("C:/repo"));
    expect(plan.command).toBe("git diff --stat");
    expect(plan.shellKind).toBe("cmd");
    expect(plan.reason).toContain("rewrote leading cd");
  });

  it("resolves relative leading cd against the requested cwd", () => {
    const plan = planWindowsCommand({
      platform: "win32",
      cwd: "C:/repo",
      command: "cd packages/app && npm test",
    });

    expect(plan.cwd).toBe(path.resolve("C:/repo/packages/app"));
    expect(plan.command).toBe("npm test");
  });

  it("rewrites multiline leading cd into cwd plus remaining command", () => {
    const plan = planWindowsCommand({
      platform: "win32",
      command: "cd C:/repo\r\nnpm install\r\nnpm test",
    });

    expect(plan.cwd).toBe(path.resolve("C:/repo"));
    expect(plan.command).toBe("npm install\nnpm test");
    expect(plan.shellKind).toBe("cmd");
    expect(plan.executionMode).toBe("script");
  });

  it("plans PowerShell syntax as PowerShell script capture", () => {
    const plan = planWindowsCommand({
      platform: "win32",
      command: 'Get-ChildItem | Where-Object { $_.Name -like "*.ts" }',
    });

    expect(plan.shellKind).toBe("powershell");
    expect(plan.shellPath).toBe(resolvePowerShellPath("powershell"));
    expect(plan.captureMode).toBe("powershellExitFile");
  });

  it("honors explicit pwsh shell", () => {
    const plan = planWindowsCommand({
      platform: "win32",
      shell: "pwsh",
      command: "git status",
    });

    expect(plan.shellKind).toBe("pwsh");
    expect(plan.shellPath).toBe("pwsh.exe");
    expect(plan.captureMode).toBe("powershellExitFile");
  });

  it("uses fire-and-forget capture for non-waiting commands", () => {
    const plan = planWindowsCommand({
      platform: "win32",
      command: "npm run dev",
      waitForCompletion: false,
    });

    expect(plan.shellKind).toBe("cmd");
    expect(plan.executionMode).toBe("raw");
    expect(plan.captureMode).toBe("fireAndForget");
  });

  it("returns syntax conflict for mixed cmd and PowerShell syntax", () => {
    const syntax = analyzeWindowsCommandSyntax(
      "echo %PATH% | Where-Object { $_ }",
    );

    expect(syntax.kind).toBe("conflict");
    expect(() =>
      planWindowsCommand({
        platform: "win32",
        command: "echo %PATH% | Where-Object { $_ }",
      }),
    ).toThrow(/Conflicting Windows shell syntax/);
  });

  it("creates cmd shell by default on Windows", () => {
    process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";

    expect(resolveWindowsShell()).toEqual({
      shellKind: "cmd",
      shellPath: "C:\\Windows\\System32\\cmd.exe",
    });
  });
});
