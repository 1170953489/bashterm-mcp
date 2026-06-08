import * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import { version as pkgVersion } from "../package.json";
import { initLogger, log, logError, disposeLogger } from "./utils/logger.js";
import { createMcpRequestHandler } from "./mcp/server.js";
import { SessionManager } from "./terminal/session-manager.js";
import type { IpcRequest, IpcResponse } from "./types/index.js";
import {
  configureClaudeCode,
  restoreClaudeCode,
} from "./integrations/claude-code/index.js";
import {
  createDiscoveryEntry,
  getSocketPathForWorkspace,
  publishDiscoveryEntry,
  readDiscoveryRegistry,
  removeDiscoveryEntry,
  selectDiscoveryEntry,
  type DiscoveryEntry,
} from "./utils/discovery.js";

let ipcServer: net.Server | undefined;
let sessionManager: SessionManager | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let discoveryEntry: DiscoveryEntry | undefined;

function getWorkspacePath(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
}

function getSocketPath(): string {
  return getSocketPathForWorkspace(getWorkspacePath());
}

function publishSocketPath(socketPath: string): DiscoveryEntry | undefined {
  try {
    const entry = createDiscoveryEntry({
      socketPath,
      workspacePath: getWorkspacePath(),
      extensionVersion: pkgVersion,
    });
    publishDiscoveryEntry(entry);
    return entry;
  } catch (err) {
    logError("Failed to publish discovery entry", err);
    return undefined;
  }
}

function cleanupSocket(socketPath: string, entry?: DiscoveryEntry): void {
  if (entry) {
    try {
      removeDiscoveryEntry(entry.id);
    } catch {
      // Ignore discovery cleanup errors.
    }
  }

  if (process.platform === "win32") return;
  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch {
    // Ignore cleanup errors
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
      const result = configureClaudeCode({
        workspacePath: getWorkspacePath(),
      });
      if (result.status === "configured") {
        log(
          "Auto-configured .claude/settings.json: complex Bash commands redirected to BashTerm MCP",
        );
        log(
          "Auto-configured .claude/mcp.json: BashTerm MCP server registered for all projects",
        );
      } else if (result.status === "unchanged") {
        log(
          "Claude Code hook already configured. Updated .claude/mcp.json if needed.",
        );
      } else if (result.status === "error") {
        logError("Failed to auto-configure .claude/settings.json", result.error);
      }
    } else {
      const result = restoreClaudeCode({
        workspacePath: getWorkspacePath(),
      });
      if (result.changed) {
        log("Restored Claude Code default Bash by removing BashTerm MCP hook and mcp.json entry");
      } else if (result.status === "error") {
        logError("Failed to restore Claude Code default Bash", result.error);
      }
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
        const restored = restoreClaudeCode({
          workspacePath: getWorkspacePath(),
        });
        if (restored.status === "error") {
          logError("Failed to restore Claude Code default Bash", restored.error);
        }
        const message = restored.changed
          ? "Claude Code default Bash restored. Restart Claude Code to apply the change."
          : "No BashTerm MCP Claude Code hook was found.";
        void vscode.window.showInformationMessage(message);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bashterm-mcp-server.enableClaudeCodeHook",
      async () => {
        await vscode.workspace
          .getConfiguration("bashterm-mcp-server")
          .update(
            "autoConfigureClaudeCode",
            true,
            vscode.ConfigurationTarget.Global,
          );
        const result = configureClaudeCode({
          workspacePath: getWorkspacePath(),
        });
        if (result.status === "error") {
          logError("Failed to enable Claude Code hook", result.error);
          void vscode.window.showErrorMessage(
            `Failed to enable Claude Code hook: ${result.error ?? "unknown error"}`,
          );
          return;
        }

        const message =
          result.status === "unchanged"
            ? "Claude Code hook is already enabled. Restart Claude Code if it is currently running."
            : "Claude Code hook enabled. Restart Claude Code to apply the change.";
        void vscode.window.showInformationMessage(message);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bashterm-mcp-server.showDiagnostics",
      () => {
        showDiagnostics(getSocketPath(), discoveryEntry);
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
  discoveryEntry = publishSocketPath(socketPath);
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
      cleanupSocket(socketPath, discoveryEntry);
      discoveryEntry = undefined;
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

  if (ipcServer) {
    ipcServer.close();
    ipcServer = undefined;
  }

  const socketPath = getSocketPath();
  cleanupSocket(socketPath, discoveryEntry);
  discoveryEntry = undefined;

  sessionManager?.dispose();
  sessionManager = undefined;

  disposeLogger();
}

function showDiagnostics(
  socketPath: string,
  entry: DiscoveryEntry | undefined,
): void {
  const output = initLogger();
  const registry = readDiscoveryRegistry();
  const selection = selectDiscoveryEntry({
    cwd: getWorkspacePath(),
  });
  const config = vscode.workspace.getConfiguration("bashterm-mcp-server");
  const lines = [
    "=== BashTerm MCP Diagnostics ===",
    `version: ${pkgVersion}`,
    `platform: ${process.platform}`,
    `process.pid: ${process.pid}`,
    `node: ${process.execPath}`,
    `tmpDir: ${os.tmpdir()}`,
    `workspace: ${getWorkspacePath()}`,
    `socketPath: ${socketPath}`,
    `socketExists: ${process.platform === "win32" ? "named-pipe" : fs.existsSync(socketPath)}`,
    `activeDiscoveryEntry: ${entry ? entry.id : "none"}`,
    `registryPath: ${selection.registryPath}`,
    `registryEntries: ${registry.entries.length}`,
    `validRegistryEntries: ${selection.validEntries.length}`,
    `selectedSource: ${selection.source}`,
    `selectedSocket: ${selection.socketPath}`,
    `selectedReason: ${selection.reason}`,
    `autoConfigureClaudeCode: ${config.get<boolean>("autoConfigureClaudeCode", true)}`,
  ];

  for (const registryEntry of registry.entries) {
    lines.push(
      `entry: id=${registryEntry.id} workspace=${registryEntry.workspacePath} socket=${registryEntry.socketPath} platform=${registryEntry.platform} pid=${registryEntry.pid} updatedAt=${new Date(registryEntry.updatedAt).toISOString()}`,
    );
  }

  output.appendLine(lines.join("\n"));
  output.show(true);
}
