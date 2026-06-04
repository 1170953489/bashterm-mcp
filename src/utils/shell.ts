import * as path from "path";

/**
 * Resolve the shell BashTerm should use when the caller didn't provide one.
 * On Windows, Node's child_process.exec defaults to cmd.exe; returning an
 * explicit cmd.exe path keeps the visible VSCode terminal in sync with exec.
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
