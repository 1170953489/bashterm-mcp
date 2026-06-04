import stripAnsi from "strip-ansi";

/**
 * Strip ANSI escape sequences from a string.
 *
 * Uses the `strip-ansi` library for CSI/SGR sequences and additionally
 * handles OSC (Operating System Command) sequences (e.g. \x1b]0;title\x07).
 *
 * Also normalizes line endings (\r\n → \n, bare \r → \n).
 */
export function cleanOutput(output: string): string {
  return stripAnsi(output)
    // OSC sequences: ESC ] ... BEL  (e.g. set window title)
    .replace(/\x1b\][^\x07]*\x07/g, "")
    // Normalize line endings
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "")
    .trim();
}

/**
 * Strip the command echo from the output lines.
 * When a command is typed in a terminal, the shell often echoes the command
 * back as the first line of output. This removes that first line if it
 * matches the given command text.
 */
export function stripCommandEcho(output: string, command: string): string {
  const lines = output.split("\n");
  if (lines.length > 0 && lines[0].trim() === command.trim()) {
    lines.shift();
    return lines.join("\n").trim();
  }
  return output;
}
