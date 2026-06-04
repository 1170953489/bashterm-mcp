import * as cp from "child_process";

/**
 * Build the options object for child_process.exec.
 * Extracted as a pure function for testability — it's the only part of
 * TerminalSession.execute() that doesn't depend on VSCode API.
 */
export function buildExecOptions(params: {
  cwd: string;
  timeoutMs: number;
  shell?: string;
  isWin: boolean;
}): cp.ExecOptions {
  return {
    cwd: params.cwd,
    timeout: params.timeoutMs,
    windowsHide: true,
    encoding: params.isWin ? null : "utf8",
    shell: params.shell,
  };
}

/**
 * Detect the text encoding used by a shell's stdout/stderr.
 * On Windows, cmd.exe outputs GBK (system code page), while
 * Unix-style shells (Git Bash, MSYS2, Cygwin, WSL) output UTF-8.
 *
 * @param shell - The shell path, if specified by the user
 * @param isWin - Whether the platform is Windows
 * @returns The encoding name for TextDecoder (e.g. "gbk" or "utf-8")
 */
export function detectShellEncoding(isWin: boolean, shell?: string): string {
  if (!isWin) return "utf-8";
  if (!shell) return "gbk"; // cmd.exe uses system code page

  const lower = shell.toLowerCase();

  // Unix-like shells output UTF-8 on Windows.
  // Use regex with path separator or start-of-string anchor to avoid
  // matching "sh" inside "powershell".
  if (
    /(^|[\/\\])(ba|z|fi|da|k)?sh(\.exe)?$/i.test(lower) ||
    lower.includes("wsl")
  ) {
    return "utf-8";
  }

  // PowerShell 7+ (pwsh) uses UTF-8; legacy powershell uses system code page
  if (lower.includes("pwsh")) {
    return "utf-8";
  }

  // Default: system code page (GBK on Chinese Windows, Shift-JIS on Japanese, etc.)
  return "gbk";
}
