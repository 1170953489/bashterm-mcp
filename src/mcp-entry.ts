#!/usr/bin/env node
/**
 * MCP Entry Point (stdio-to-IPC bridge)
 *
 * This is the process spawned by VSCode's MCP auto-discovery.
 * It reads JSON-RPC messages from stdin, forwards them to the
 * extension host via a Unix domain socket, and relays responses
 * back to stdout.
 */

import * as net from "net";
import { selectDiscoveryEntry } from "./utils/discovery.js";

const DISCOVERY_SELECTION = selectDiscoveryEntry();
const SOCKET_PATH = DISCOVERY_SELECTION.socketPath;
const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 30;

if (process.argv.includes("--status") || process.argv.includes("--diagnose")) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: DISCOVERY_SELECTION.source !== "fallback",
        platform: process.platform,
        pid: process.pid,
        cwd: process.cwd(),
        node: process.execPath,
        socketPath: SOCKET_PATH,
        discovery: DISCOVERY_SELECTION,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  jsonRpcId: string | number;
  reject: (reason: unknown) => void;
}

class StdioToIpcBridge {
  private socket: net.Socket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private socketBuffer = "";
  private stdinBuffer = "";
  private connected = false;
  private reconnectAttempts = 0;
  private nextIpcRequestId = 0;

  async start(): Promise<void> {
    await this.connectToExtension();
    this.listenStdin();
  }

  private async connectToExtension(): Promise<void> {
    return new Promise((resolve, reject) => {
      const attempt = () => {
        this.socket = net.createConnection(SOCKET_PATH, () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.setupSocketListeners();
          resolve();
        });

        this.socket.on("error", (err) => {
          this.connected = false;
          this.reconnectAttempts++;

          if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            const errorMsg = `Failed to connect to extension host after ${MAX_RECONNECT_ATTEMPTS} attempts: ${err.message}`;
            process.stderr.write(errorMsg + "\n");
            reject(new Error(errorMsg));
            return;
          }

          setTimeout(attempt, RECONNECT_DELAY_MS);
        });
      };

      attempt();
    });
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on("data", (data) => {
      this.socketBuffer += data.toString();

      let newlineIndex: number;
      while ((newlineIndex = this.socketBuffer.indexOf("\n")) !== -1) {
        const messageStr = this.socketBuffer.slice(0, newlineIndex);
        this.socketBuffer = this.socketBuffer.slice(newlineIndex + 1);

        if (!messageStr.trim()) continue;

        try {
          const ipcResponse = JSON.parse(messageStr);
          this.handleIpcResponse(ipcResponse);
        } catch {
          process.stderr.write(
            `Failed to parse IPC response: ${messageStr}\n`,
          );
        }
      }
    });

    this.socket.on("close", () => {
      this.connected = false;
      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error("IPC connection closed"));
        this.pendingRequests.delete(id);
      }
    });

    this.socket.on("error", (err) => {
      process.stderr.write(`IPC socket error: ${err.message}\n`);
    });
  }

  private handleIpcResponse(ipcResponse: {
    id: string;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
  }): void {
    const pending = this.pendingRequests.get(ipcResponse.id);
    if (!pending) {
      // This might be a notification or unknown response
      return;
    }

    this.pendingRequests.delete(ipcResponse.id);

    if (ipcResponse.error) {
      // Build JSON-RPC error response
      const errorResponse: JsonRpcMessage = {
        jsonrpc: "2.0",
        id: pending.jsonRpcId,
        error: ipcResponse.error,
      };
      this.writeStdout(errorResponse);
    } else {
      // Build JSON-RPC success response
      const successResponse: JsonRpcMessage = {
        jsonrpc: "2.0",
        id: pending.jsonRpcId,
        result: ipcResponse.result,
      };
      this.writeStdout(successResponse);
    }
  }

  private listenStdin(): void {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      this.stdinBuffer += chunk;

      let newlineIndex: number;
      while ((newlineIndex = this.stdinBuffer.indexOf("\n")) !== -1) {
        const messageStr = this.stdinBuffer.slice(0, newlineIndex);
        this.stdinBuffer = this.stdinBuffer.slice(newlineIndex + 1);

        if (!messageStr.trim()) continue;

        try {
          const jsonRpc: JsonRpcMessage = JSON.parse(messageStr);
          this.handleJsonRpcRequest(jsonRpc);
        } catch {
          const errorResponse: JsonRpcMessage = {
            jsonrpc: "2.0",
            id: undefined,
            error: { code: -32700, message: "Parse error" },
          };
          this.writeStdout(errorResponse);
        }
      }
    });

    process.stdin.on("end", () => {
      this.shutdown();
    });
  }

  private handleJsonRpcRequest(message: JsonRpcMessage): void {
    // JSON-RPC notifications have no id field and expect no response.
    // Forward them without tracking in pendingRequests to avoid leaks.
    const isNotification = message.id === undefined || message.id === null;

    if (typeof message.method !== "string") {
      if (!isNotification) {
        const errorResponse: JsonRpcMessage = {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32600,
            message: "Invalid Request",
          },
        };
        this.writeStdout(errorResponse);
      }
      return;
    }

    if (!this.connected || !this.socket) {
      if (!isNotification) {
        const errorResponse: JsonRpcMessage = {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32603,
            message: "Extension host not connected",
          },
        };
        this.writeStdout(errorResponse);
      }
      return;
    }

    // Forward to extension host via IPC
    const ipcRequestId = isNotification
      ? ""
      : String(++this.nextIpcRequestId);
    const ipcRequest = {
      id: ipcRequestId,
      method: message.method,
      params: message.params,
    };

    if (!isNotification) {
      this.pendingRequests.set(ipcRequest.id, {
        jsonRpcId: message.id,
        reject: (err) => {
          const errorResponse: JsonRpcMessage = {
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32603,
              message: err instanceof Error ? err.message : String(err),
            },
          };
          this.writeStdout(errorResponse);
        },
      });
    }

    this.socket.write(JSON.stringify(ipcRequest) + "\n");
  }

  private writeStdout(message: JsonRpcMessage): void {
    process.stdout.write(JSON.stringify(message) + "\n");
  }

  private shutdown(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    process.exit(0);
  }
}

// Start the bridge
const bridge = new StdioToIpcBridge();
bridge.start().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
