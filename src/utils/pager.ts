/**
 * Disable interactive pagers by setting environment variables that
 * replace the pager with `cat`.
 *
 * `VAR=val command` is POSIX shell syntax — the variable only affects
 * the current command and does not leak to subsequent commands.
 * Works with bash, zsh, fish, and other POSIX shells.
 *
 * On Windows, pagers are rarely an issue (cmd's `more` and PowerShell's
 * `Out-Host -Paging` don't respect PAGER), so we leave commands unchanged.
 */
export function disablePager(command: string): string {
  if (process.platform === "win32") {
    return command;
  }
  return `PAGER=cat MANPAGER=cat GIT_PAGER=cat SYSTEMD_PAGER=cat ${command}`;
}
