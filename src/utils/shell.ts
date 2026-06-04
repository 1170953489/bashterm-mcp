import * as path from "path";

/**
 * Resolve the shell BashTerm should use when the caller didn't provide one.
 * On Windows, BashTerm uses an explicit cmd.exe path so the visible VSCode
 * terminal doesn't silently fall back to the user's PowerShell profile.
 */
export function resolveDefaultShell(platform = process.platform): string | undefined {
  if (platform !== "win32") return undefined;

  return (
    process.env.COMSPEC ||
    path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe")
  );
}

export function resolveShell(shell?: string): string | undefined {
  return shell || resolveDefaultShell();
}

export function isCmdShell(shell?: string): boolean {
  if (!shell) return false;
  return /(^|[\/\\])cmd(\.exe)?$/i.test(shell);
}
