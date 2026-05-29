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

function getSocketPath(): string {
  const tmpDir = os.tmpdir();
  // Use a hash based on the workspace to make the socket unique per VSCode window
  const crypto = require("crypto");
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
  const hash = crypto.createHash("md5").update(workspace).digest("hex").slice(0, 8);
  const isWin = process.platform === "win32";
  const socketPath = isWin
    ? path.join("\\\\?\\pipe", `vscode-terminal-mcp-${hash}`)
    : path.join(tmpDir, `vscode-terminal-mcp-${hash}.sock`);
  // Write the socket path to a well-known discovery file so mcp-entry.ts can find it
  const discoveryPath = path.join(tmpDir, "vscode-terminal-mcp.discovery");
  try {
    fs.writeFileSync(discoveryPath, socketPath);
  } catch {
    // Ignore write errors
  }
  return socketPath;
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

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = initLogger();
  log("Terminal MCP extension activating...");

  // Initialize session manager
  sessionManager = new SessionManager();

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.text = "$(terminal) MCP: 0 sessions";
  statusBarItem.tooltip = "Terminal MCP - Active sessions";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Update status bar when sessions change
  sessionManager.onSessionsChanged(() => {
    if (statusBarItem && sessionManager) {
      const count = sessionManager.getActiveSessionCount();
      statusBarItem.text = `$(terminal) MCP: ${count} session${count !== 1 ? "s" : ""}`;
    }
  });

  // Create MCP request handler
  const handleMcpRequest = createMcpRequestHandler(sessionManager);

  // Setup IPC server
  const socketPath = getSocketPath();
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

  log("Terminal MCP extension activated");
  outputChannel.show(true); // Show but don't focus
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
  log("Terminal MCP extension deactivating...");

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
