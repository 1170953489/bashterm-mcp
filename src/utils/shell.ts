import * as path from "path";

export type PowerShellPreference = "powershell" | "pwsh";

export function resolveShell(
  shell?: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (!shell) return undefined;
  return normalizeShellAlias(shell, platform);
}

export function isCmdShell(shell?: string): boolean {
  if (!shell) return false;
  return /(^|[\/\\])cmd(\.exe)?$/i.test(shell);
}

export function getCmdShellPath(): string {
  return (
    process.env.COMSPEC ||
    path.win32.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "cmd.exe",
    )
  );
}

export function resolvePowerShellPath(
  preference: PowerShellPreference = "powershell",
): string {
  if (preference === "pwsh") return "pwsh.exe";
  return path.win32.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

export function normalizeShellAlias(
  shell: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") return shell;

  switch (shell.toLowerCase()) {
    case "vscode":
      return undefined;
    case "cmd":
      return getCmdShellPath();
    case "powershell":
      return resolvePowerShellPath("powershell");
    case "pwsh":
      return resolvePowerShellPath("pwsh");
    default:
      return shell;
  }
}
