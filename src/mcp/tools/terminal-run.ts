import type { SessionManager } from "../../terminal/session-manager.js";
import type { McpToolResponse } from "../../types/index.js";
import { terminalRunSchema } from "./schemas.js";
import { formatExecuteResult } from "./command-utils.js";
import { log } from "../../utils/logger.js";

export async function handleTerminalRun(
  params: unknown,
  sessionManager: SessionManager,
): Promise<McpToolResponse> {
  const input = terminalRunSchema.parse(params);

  let command = input.command;
  let cwd = input.cwd;
  let shell: string | undefined;
  let shellKind: "cmd" | "powershell" | "pwsh" | "vscode" | undefined;

  if (process.platform === "win32") {
    try {
      const plan = sessionManager.planWindowsRun({
        command: input.command,
        cwd: input.cwd,
        shell: input.shell,
        waitForCompletion: input.waitForCompletion,
      });
      command = plan.command;
      cwd = plan.cwd;
      shell = plan.shellPath;
      shellKind = plan.shellKind;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          { type: "text", text: `Windows command planner error: ${errorMsg}` },
        ],
        isError: true,
      };
    }
  } else {
    const resolved = sessionManager.resolveCreateShell(input.shell);
    shell = resolved.shell;
    shellKind = resolved.shellKind;
  }

  // ── Reuse matching ──────────────────────────────────────────────
  // Linux / macOS: pick the first active idle terminal, no questions asked.
  // Windows: two-pass strategy — prefer same/child cwd, then any idle.
  let sessionId: string | undefined;
  let isNewSession = false;
  const existing = sessionManager.listSessions(input.agentId);

  if (process.platform !== "win32") {
    for (const s of existing) {
      if (!s.isActive) {
        log(`[reuse] skip ${s.sessionId}: not active`);
        continue;
      }
      const session = sessionManager.getSession(s.sessionId);
      if (!session) {
        log(`[reuse] skip ${s.sessionId}: session not found`);
        continue;
      }
      if (session.isBusy) {
        log(`[reuse] skip ${s.sessionId}: busy`);
        continue;
      }
      sessionId = s.sessionId;
      log(`[reuse] matched ${s.sessionId}`);
      break;
    }
  } else {
    // Windows: prefer matching cwd/shell/env, fallback to any idle
    for (const s of existing) {
      if (!s.isActive) continue;
      if (input.name && s.name !== input.name) continue;
      if (cwd && s.cwd !== cwd) continue;
      if (s.shell !== shell) continue;
      if (s.shellKind !== shellKind) continue;
      if (input.env && !envsEqual(input.env, s.env)) continue;
      const session = sessionManager.getSession(s.sessionId);
      if (session && !session.isBusy) {
        sessionId = s.sessionId;
        break;
      }
    }
    // Fallback: any idle Windows session
    if (!sessionId) {
      for (const s of existing) {
        if (!s.isActive) continue;
        const session = sessionManager.getSession(s.sessionId);
        if (session && !session.isBusy) {
          sessionId = s.sessionId;
          break;
        }
      }
    }
  }

  // Create new session only if no reusable one exists
  if (!sessionId) {
    const sessionInfo = sessionManager.createSession({
      name:
        input.name ??
        (() => {
          const d = new Date();
          const pad = (n: number) => String(n).padStart(2, "0");
          return `BashTerm-${pad(d.getFullYear() % 100)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;
        })(),
      cwd,
      env: input.env,
      shell,
      shellKind,
      agentId: input.agentId,
    });
    sessionId = sessionInfo.sessionId;
    isNewSession = true;
  }

  if (isNewSession) {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return {
        content: [
          { type: "text", text: "Error: Failed to get terminal session." },
        ],
        isError: true,
      };
    }
    // Wait for the shell to be ready before sending the first command.
    // Shell integration fires early; otherwise falls back to a 2-second timeout.
    await session.whenReady();
    return executeCommand(sessionId, command, input, sessionManager);
  }

  return executeCommand(sessionId, command, input, sessionManager);
}

async function executeCommand(
  sessionId: string,
  command: string,
  input: { timeoutMs?: number; waitForCompletion?: boolean },
  sessionManager: SessionManager,
): Promise<McpToolResponse> {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return {
      content: [
        { type: "text", text: "Error: Failed to get terminal session." },
      ],
      isError: true,
    };
  }

  const validation = sessionManager.validateCommand(command);
  if (!validation.valid) {
    return {
      content: [
        { type: "text", text: `Command blocked: ${validation.reason}` },
      ],
      isError: true,
    };
  }

  const timeoutMs = input.timeoutMs ?? sessionManager.getDefaultTimeout();
  const waitForCompletion = input.waitForCompletion ?? true;

  const result = await session.execute(command, timeoutMs, waitForCompletion);

  return formatExecuteResult(
    result.output,
    command,
    result.exitCode,
    result.timedOut,
    result.durationMs,
    sessionId,
    timeoutMs,
  );
}

/** Shallow comparison of two env record objects. */
function envsEqual(
  a: Record<string, string>,
  b: Record<string, string> | undefined,
): boolean {
  if (!b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => a[k] === b[k]);
}
