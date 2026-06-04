import type { SessionManager } from "../../terminal/session-manager.js";
import type { McpToolResponse } from "../../types/index.js";
import { terminalExecuteSchema } from "./schemas.js";
import { formatExecuteResult } from "./command-utils.js";

export async function handleTerminalExecute(
  params: unknown,
  sessionManager: SessionManager,
): Promise<McpToolResponse> {
  const input = terminalExecuteSchema.parse(params);

  const session = sessionManager.getSession(input.sessionId);
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Session "${input.sessionId}" not found. Use terminal_list to see active sessions.`,
        },
      ],
      isError: true,
    };
  }

  const validation = sessionManager.validateCommand(input.command);
  if (!validation.valid) {
    return {
      content: [
        {
          type: "text",
          text: `Command blocked: ${validation.reason}`,
        },
      ],
      isError: true,
    };
  }

  const timeoutMs = input.timeoutMs ?? sessionManager.getDefaultTimeout();
  const waitForCompletion = input.waitForCompletion ?? true;

  const result = await session.execute(
    input.command,
    timeoutMs,
    waitForCompletion,
  );

  return formatExecuteResult(
    result.output,
    input.command,
    result.exitCode,
    result.timedOut,
    result.durationMs,
    input.sessionId,
    timeoutMs,
  );
}
