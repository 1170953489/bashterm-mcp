import { describe, it, expect, afterEach } from "vitest";
import {
  detectWindowsShellKind,
  isCmdShell,
  resolveDefaultShell,
  resolveShell,
  resolveShellPlan,
  resolveShellWithMetadata,
} from "../../src/utils/shell.js";

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

  it("uses VSCode default profile on Windows by default", () => {
    expect(resolveDefaultShell("win32")).toBeUndefined();
  });

  it("uses COMSPEC when Windows default shell is cmd", () => {
    process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";

    expect(resolveDefaultShell("win32", "cmd")).toBe(
      "C:\\Windows\\System32\\cmd.exe",
    );
  });

  it("falls back to SystemRoot cmd.exe when COMSPEC is missing", () => {
    delete process.env.COMSPEC;
    process.env.SystemRoot = "D:\\Windows";

    expect(resolveDefaultShell("win32", "cmd")).toBe(
      "D:\\Windows\\System32\\cmd.exe",
    );
  });

  it("keeps caller-provided shells unchanged", () => {
    expect(resolveShell("/bin/zsh")).toBe("/bin/zsh");
  });

  it("normalizes Windows shell aliases", () => {
    process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";

    expect(resolveShell("cmd", { platform: "win32" })).toBe(
      "C:\\Windows\\System32\\cmd.exe",
    );
    expect(resolveShell("vscode", { platform: "win32" })).toBeUndefined();
    expect(resolveShell("pwsh", { platform: "win32" })).toBe("pwsh.exe");
  });

  it("detects cmd.exe shell paths", () => {
    expect(isCmdShell("C:\\Windows\\System32\\cmd.exe")).toBe(true);
    expect(isCmdShell("cmd")).toBe(true);
    expect(
      isCmdShell(
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ),
    ).toBe(false);
  });

  it("detects high-confidence cmd commands", () => {
    const detection = detectWindowsShellKind("set FOO=bar\r\necho %FOO%");

    expect(detection.kind).toBe("cmd");
    expect(detection.confidence).toBe("high");
  });

  it("detects high-confidence PowerShell commands", () => {
    const detection = detectWindowsShellKind(
      'Get-ChildItem | Where-Object { $_.Name -like "*.ts" }',
    );

    expect(detection.kind).toBe("powershell");
    expect(detection.confidence).toBe("high");
  });

  it("leaves ambiguous commands unknown", () => {
    const detection = detectWindowsShellKind("npm test");

    expect(detection.kind).toBe("unknown");
    expect(detection.confidence).toBe("low");
  });

  it("routes high-confidence Windows commands before default shell", () => {
    process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";

    const cmd = resolveShellWithMetadata(undefined, {
      platform: "win32",
      windowsDefaultShell: "vscode",
      command: "dir /s /b",
    });
    const powershell = resolveShellWithMetadata(undefined, {
      platform: "win32",
      windowsDefaultShell: "vscode",
      command: "Write-Output $env:Path",
    });
    const ambiguous = resolveShellWithMetadata(undefined, {
      platform: "win32",
      windowsDefaultShell: "vscode",
      command: "npm test",
    });

    expect(cmd.source).toBe("detected");
    expect(cmd.shell).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(powershell.source).toBe("detected");
    expect(powershell.shell).toContain("powershell.exe");
    expect(ambiguous.source).toBe("default");
    expect(ambiguous.shell).toBeUndefined();
  });

  it("honors explicit shell before detection", () => {
    const resolved = resolveShellWithMetadata("pwsh", {
      platform: "win32",
      command: "dir /s /b",
    });

    expect(resolved.source).toBe("explicit");
    expect(resolved.shell).toBe("pwsh.exe");
  });

  it("builds cmd shell plans with exit-code file capture", () => {
    process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";

    const plan = resolveShellPlan(undefined, {
      platform: "win32",
      windowsDefaultShell: "vscode",
      command: "set FOO=bar\r\necho %FOO%",
    });

    expect(plan.source).toBe("detected");
    expect(plan.shellKind).toBe("cmd");
    expect(plan.shell).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(plan.captureMode).toBe("cmdExitFile");
    expect(plan.reason).toContain("detected cmd");
  });

  it("builds PowerShell shell plans with shell integration capture", () => {
    const plan = resolveShellPlan(undefined, {
      platform: "win32",
      windowsDefaultShell: "vscode",
      command: "Write-Output $env:Path",
    });

    expect(plan.source).toBe("detected");
    expect(plan.shellKind).toBe("powershell");
    expect(plan.captureMode).toBe("shellIntegration");
    expect(plan.reason).toContain("detected powershell");
  });

  it("keeps ambiguous Windows commands on the configured default shell", () => {
    const plan = resolveShellPlan(undefined, {
      platform: "win32",
      windowsDefaultShell: "vscode",
      command: "npm test",
    });

    expect(plan.source).toBe("default");
    expect(plan.shellKind).toBe("vscode");
    expect(plan.shell).toBeUndefined();
    expect(plan.captureMode).toBe("shellIntegration");
  });

  it("uses explicit shell in shell plans before command detection", () => {
    const plan = resolveShellPlan("cmd", {
      platform: "win32",
      command: "Write-Output $env:Path",
    });

    expect(plan.source).toBe("explicit");
    expect(plan.shellKind).toBe("cmd");
    expect(plan.captureMode).toBe("cmdExitFile");
  });
});
