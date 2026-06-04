import * as vscode from "vscode";
import * as net from "net";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { initLogger, log, logError, disposeLogger } from "./utils/logger.js";
import { createMcpRequestHandler } from "./mcp/server.js";
import { SessionManager } from "./terminal/session-manager.js";
import type { IpcRequest, IpcResponse } from "./types/index.js";

let ipcServer: net.Server | undefined;
let sessionManager: SessionManager | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

const CLAUDE_CODE_BASH_BLOCK_MESSAGE =
  "Please use BashTerm MCP tools (run / exec / read) instead of the built-in Bash tool. " +
  "These commands execute visibly in VSCode terminal tabs.";

function getSocketPath(): string {
  const tmpDir = os.tmpdir();
  // Use a hash based on the workspace to make the socket unique per VSCode window
  const crypto = require("crypto");
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
  const hash = crypto
    .createHash("md5")
    .update(workspace)
    .digest("hex")
    .slice(0, 8);
  const isWin = process.platform === "win32";
  const socketPath = isWin
    ? path.join("\\\\?\\pipe", `bashterm-mcp-${hash}`)
    : path.join(tmpDir, `bashterm-mcp-${hash}.sock`);
  return socketPath;
}

function publishSocketPath(socketPath: string): void {
  // Write the socket path to a well-known discovery file so mcp-entry.ts can find it
  const discoveryPath = path.join(os.tmpdir(), "bashterm-mcp.discovery");
  try {
    fs.writeFileSync(discoveryPath, socketPath);
  } catch {
    // Ignore write errors
  }
}

function cleanupSocket(socketPath: string): void {
  if (process.platform === "win32") return;
  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

function getClaudeCodeSettingsPath(): {
  claudeDir: string;
  settingsPath: string;
} {
  const claudeDir = path.join(os.homedir(), ".claude");
  return {
    claudeDir,
    settingsPath: path.join(claudeDir, "settings.json"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLegacyBashTermClaudeCodeHook(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value) || value.matcher !== "Bash") return false;

  const legacyMessage = value.message;
  return (
    value.action === "block" &&
    typeof legacyMessage === "string" &&
    legacyMessage.includes("BashTerm MCP")
  );
}

function isCurrentBashTermClaudeCodeHook(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value) || value.matcher !== "Bash") return false;

  if (!Array.isArray(value.hooks)) return false;
  return value.hooks.some(
    (handler) =>
      isRecord(handler) &&
      handler.type === "command" &&
      typeof handler.command === "string" &&
      handler.command.includes("BashTerm MCP"),
  );
}

function isBashTermClaudeCodeHook(
  value: unknown,
): value is Record<string, unknown> {
  return (
    isLegacyBashTermClaudeCodeHook(value) ||
    isCurrentBashTermClaudeCodeHook(value)
  );
}

function readClaudeCodeSettings(settingsPath: string): Record<string, unknown> {
  if (!fs.existsSync(settingsPath)) return {};

  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    log("Failed to parse .claude/settings.json");
    return {};
  }
}

function writeClaudeCodeSettings(
  claudeDir: string,
  settingsPath: string,
  settings: Record<string, unknown>,
): void {
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function createClaudeCodeBashBlockHook(): Record<string, unknown> {
  const blockCommand =
    process.platform === "win32"
      ? `[Console]::Error.WriteLine('${CLAUDE_CODE_BASH_BLOCK_MESSAGE}'); exit 2`
      : `sh -c 'printf "%s\\n" "${CLAUDE_CODE_BASH_BLOCK_MESSAGE}"; exit 2'`;

  const hook: Record<string, unknown> = {
    matcher: "Bash",
    hooks: [
      {
        type: "command",
        command: blockCommand,
      },
    ],
  };

  if (process.platform === "win32") {
    const handlers = hook.hooks as Array<Record<string, unknown>>;
    handlers[0].shell = "powershell";
  }

  return hook;
}

/**
 * Auto-configure Claude Code to prefer BashTerm MCP over the built-in Bash tool.
 *
 * Ensures user-level .claude/settings.json contains a PreToolUse hook that blocks
 * the built-in Bash tool with a message pointing to BashTerm MCP.
 *
 * Idempotent: skips if the hook is already present.
 */
function autoConfigureClaudeCode(): void {
  // Write to user-level config (applies globally, not tied to a specific project)
  const { claudeDir, settingsPath } = getClaudeCodeSettingsPath();
  const settings = readClaudeCodeSettings(settingsPath);

  // Merge the hook without overwriting existing entries
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  const existingPreToolUse = Array.isArray(hooks.PreToolUse)
    ? hooks.PreToolUse
    : [];
  const preToolUse = existingPreToolUse.filter(
    (h): h is Record<string, unknown> =>
      isRecord(h) && !isBashTermClaudeCodeHook(h),
  );

  const needsCleanup = preToolUse.length !== existingPreToolUse.length;
  if (!needsCleanup) {
    const alreadyConfigured = existingPreToolUse.some(
      isCurrentBashTermClaudeCodeHook,
    );
    if (alreadyConfigured) return;
  }

  preToolUse.push(createClaudeCodeBashBlockHook());
  hooks.PreToolUse = preToolUse;
  settings.hooks = hooks;

  try {
    writeClaudeCodeSettings(claudeDir, settingsPath, settings);
    log(
      "Auto-configured .claude/settings.json: Bash tool blocked, BashTerm MCP preferred",
    );
  } catch (err) {
    logError("Failed to auto-configure .claude/settings.json", err);
  }
}

function restoreClaudeCodeDefaultBash(): boolean {
  const { claudeDir, settingsPath } = getClaudeCodeSettingsPath();
  if (!fs.existsSync(settingsPath)) return false;

  const settings = readClaudeCodeSettings(settingsPath);
  if (!isRecord(settings.hooks)) return false;

  const hooks = settings.hooks;
  const existingPreToolUse = Array.isArray(hooks.PreToolUse)
    ? hooks.PreToolUse
    : [];
  const preToolUse = existingPreToolUse.filter(
    (hook) => !isBashTermClaudeCodeHook(hook),
  );
  if (preToolUse.length === existingPreToolUse.length) return false;

  if (preToolUse.length > 0) {
    hooks.PreToolUse = preToolUse;
  } else {
    delete hooks.PreToolUse;
  }

  if (Object.keys(hooks).length > 0) {
    settings.hooks = hooks;
  } else {
    delete settings.hooks;
  }

  try {
    writeClaudeCodeSettings(claudeDir, settingsPath, settings);
    log("Restored Claude Code default Bash by removing BashTerm MCP hook");
    return true;
  } catch (err) {
    logError("Failed to restore Claude Code default Bash", err);
    return false;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = initLogger();
  log("BashTerm MCP extension activating...");

  const applyClaudeCodePreference = (): void => {
    const autoConfigureClaude = vscode.workspace
      .getConfiguration("bashterm-mcp-server")
      .get<boolean>("autoConfigureClaudeCode", true);
    if (autoConfigureClaude) {
      autoConfigureClaudeCode();
    } else {
      restoreClaudeCodeDefaultBash();
    }
  };
  applyClaudeCodePreference();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration(
          "bashterm-mcp-server.autoConfigureClaudeCode",
        )
      ) {
        applyClaudeCodePreference();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bashterm-mcp-server.restoreClaudeCodeDefaultBash",
      () => {
        const restored = restoreClaudeCodeDefaultBash();
        const message = restored
          ? "Claude Code default Bash restored. Restart Claude Code to apply the change."
          : "No BashTerm MCP Claude Code hook was found.";
        void vscode.window.showInformationMessage(message);
      },
    ),
  );

  // Initialize session manager
  sessionManager = new SessionManager();

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.text = "$(terminal) BashTerm: 0 sessions";
  statusBarItem.tooltip = "BashTerm MCP - Active sessions";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Update status bar when sessions change
  sessionManager.onSessionsChanged(() => {
    if (statusBarItem && sessionManager) {
      const count = sessionManager.getActiveSessionCount();
      statusBarItem.text = `$(terminal) BashTerm: ${count} session${count !== 1 ? "s" : ""}`;
    }
  });

  // Create MCP request handler
  const handleMcpRequest = createMcpRequestHandler(sessionManager);

  // Setup IPC server
  const socketPath = getSocketPath();
  publishSocketPath(socketPath);
  cleanupSocket(socketPath);

  ipcServer = net.createServer((connection) => {
    log("IPC client connected");

    let buffer = "";

    connection.on("data", (data) => {
      buffer += data.toString();

      // Process complete JSON messages (newline-delimited)
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const messageStr = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (!messageStr.trim()) continue;

        try {
          const request: IpcRequest = JSON.parse(messageStr);
          handleIpcRequest(request, connection, handleMcpRequest);
        } catch (err) {
          logError("Failed to parse IPC message", err);
          const errorResponse: IpcResponse = {
            id: "unknown",
            error: { code: -32700, message: "Parse error" },
          };
          connection.write(JSON.stringify(errorResponse) + "\n");
        }
      }
    });

    connection.on("error", (err) => {
      logError("IPC connection error", err);
    });

    connection.on("close", () => {
      log("IPC client disconnected");
    });
  });

  ipcServer.listen(socketPath, () => {
    log(`IPC server listening on ${socketPath}`);
  });

  ipcServer.on("error", (err) => {
    logError("IPC server error", err);
  });

  // Cleanup on extension deactivation
  context.subscriptions.push({
    dispose: () => {
      cleanupSocket(socketPath);
    },
  });

  context.subscriptions.push({
    dispose: () => {
      sessionManager?.dispose();
    },
  });

  log("BashTerm MCP extension activated");
  // Output channel is created but kept in the background.
  // Users can open it via View → Output → "BashTerm MCP" when debugging.
}

async function handleIpcRequest(
  request: IpcRequest,
  connection: net.Socket,
  handleMcpRequest: (method: string, params?: unknown) => Promise<unknown>,
): Promise<void> {
  try {
    const result = await handleMcpRequest(request.method, request.params);
    const response: IpcResponse = {
      id: request.id,
      result,
    };
    connection.write(JSON.stringify(response) + "\n");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logError(`Error handling IPC request ${request.method}`, err);
    const response: IpcResponse = {
      id: request.id,
      error: { code: -32603, message: errorMessage },
    };
    connection.write(JSON.stringify(response) + "\n");
  }
}

export function deactivate(): void {
  log("BashTerm MCP extension deactivating...");
  restoreClaudeCodeDefaultBash();

  if (ipcServer) {
    ipcServer.close();
    ipcServer = undefined;
  }

  const socketPath = getSocketPath();
  cleanupSocket(socketPath);

  sessionManager?.dispose();
  sessionManager = undefined;

  disposeLogger();
}
