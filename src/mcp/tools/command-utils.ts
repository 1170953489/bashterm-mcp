import type { McpToolResponse } from "../../types/index.js";
import { cleanOutput, stripCommandEcho } from "../../utils/ansi.js";

/**
 * Format the result of a command execution into a standard McpToolResponse.
 *
 * Shared between the `exec` and `run` tool handlers to avoid duplicated
 * ANSI-cleaning, echo-stripping, and status-line formatting logic.
 */
export function formatExecuteResult(
  rawOutput: string,
  command: string,
  exitCode: number | null,
  timedOut: boolean,
  durationMs: number,
  sessionId: string,
  timeoutMs: number,
): McpToolResponse {
  const clean = stripCommandEcho(cleanOutput(rawOutput), command);

  const statusParts = [
    `exit: ${exitCode ?? "n/a"}`,
    `${durationMs}ms`,
    sessionId,
  ];

  let text = `$ ${command}\n${clean}\n\n[${statusParts.join(" | ")}]`;

  if (timedOut) {
    text += `\n[TIMED OUT after ${timeoutMs}ms - session still active, use read to get more output]`;
  }

  return {
    content: [{ type: "text", text }],
    isError: exitCode !== null && exitCode !== 0,
  };
}
