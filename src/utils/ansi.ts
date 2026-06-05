/**
 * Strip ANSI escape sequences from a string.
 *
 * Handles common CSI/SGR sequences and OSC (Operating System Command)
 * sequences (e.g. \x1b]0;title\x07).
 *
 * Also normalizes line endings (\r\n to \n, bare \r removed).
 */
export function cleanOutput(output: string): string {
  return output
    // OSC sequences: ESC ] ... BEL  (e.g. set window title)
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(ansiSequencePattern, "")
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

// ESC followed by a CSI/control sequence. This covers color, cursor, erase,
// and similar terminal control sequences used in captured output.
const ansiSequencePattern = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
