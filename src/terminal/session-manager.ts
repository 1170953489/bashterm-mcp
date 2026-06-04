import * as vscode from "vscode";
import * as path from "path";
import { TerminalSession } from "./session.js";
import { CommandGuard } from "../security/command-guard.js";
import type {
  TerminalSessionConfig,
  TerminalSessionInfo,
  SecurityConfig,
  ValidationResult,
} from "../types/index.js";
import { log, logError } from "../utils/logger.js";

export class SessionManager {
  private sessions = new Map<string, TerminalSession>();
  private onSessionsChangedEmitter = new vscode.EventEmitter<void>();
  readonly onSessionsChanged = this.onSessionsChangedEmitter.event;
  private idleReaperInterval: ReturnType<typeof setInterval> | null = null;
  private commandGuard: CommandGuard;

  constructor() {
    this.commandGuard = new CommandGuard(this.getConfig());

    // Start idle session reaper (disabled when idleTimeoutMs = 0)
    this.startIdleReaper();

    // Listen for terminals being closed externally
    vscode.window.onDidCloseTerminal((terminal) => {
      for (const [id, session] of this.sessions) {
        if (session.getTerminal() === terminal) {
          log(`Terminal closed externally for session ${id}`);
          session.dispose();
          this.sessions.delete(id);
          this.onSessionsChangedEmitter.fire();
          break;
        }
      }
    });
  }

  private getConfig(): SecurityConfig {
    const config = vscode.workspace.getConfiguration("terminalMcp");
    return {
      allowedCommands: config.get<string[]>("allowedCommands", []),
      blockedCommands: config.get<string[]>("blockedCommands", [
        "rm -rf /",
        "mkfs",
        "dd if=",
        ":(){ :|:& };:",
      ]),
      allowedDirectories: config.get<string[]>("allowedDirectories", []),
      defaultTimeoutMs: config.get<number>("defaultTimeoutMs", 30000),
      maxConcurrentSessions: config.get<number>("maxConcurrentSessions", 10),
      maxOutputLines: config.get<number>("maxOutputLines", 10000),
      idleTimeoutMs: config.get<number>("idleTimeoutMs", 300000),
    };
  }

  private startIdleReaper(): void {
    // Check every 60 seconds for idle sessions
    this.idleReaperInterval = setInterval(() => {
      const config = this.getConfig();
      if (config.idleTimeoutMs <= 0) return;

      for (const [id, session] of this.sessions) {
        if (session.isBusy) continue; // Don't reap sessions with running commands
        if (session.isIdle(config.idleTimeoutMs)) {
          log(`Reaping idle session ${id}`);
          session.dispose();
          this.sessions.delete(id);
          this.onSessionsChangedEmitter.fire();
        }
      }
    }, 60000);
  }

  /**
   * Create a new terminal session.
   */
  createSession(config: TerminalSessionConfig): TerminalSessionInfo {
    const secConfig = this.getConfig();

    // Refresh command guard with latest config
    this.commandGuard.updateConfig(secConfig);

    // Check concurrent session limit
    if (this.sessions.size >= secConfig.maxConcurrentSessions) {
      throw new Error(
        `Maximum concurrent sessions (${secConfig.maxConcurrentSessions}) reached. Close existing sessions first.`,
      );
    }

    // Validate working directory via CommandGuard
    if (config.cwd) {
      const dirValidation = this.commandGuard.validateDirectory(config.cwd);
      if (!dirValidation.valid) {
        throw new Error(dirValidation.reason ?? "Directory not allowed.");
      }
    }

    const session = new TerminalSession(config, secConfig.maxOutputLines);
    this.sessions.set(session.sessionId, session);
    this.onSessionsChangedEmitter.fire();

    return session.getInfo();
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all active sessions, optionally filtered by agentId.
   */
  listSessions(agentId?: string): TerminalSessionInfo[] {
    const sessions: TerminalSessionInfo[] = [];
    for (const session of this.sessions.values()) {
      const info = session.getInfo();
      if (agentId === undefined || info.agentId === agentId) {
        sessions.push(info);
      }
    }
    return sessions;
  }

  /**
   * Close and remove a session.
   */
  closeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.dispose();
    this.sessions.delete(sessionId);
    this.onSessionsChangedEmitter.fire();
    return true;
  }

  /**
   * Validate a command against security rules via CommandGuard.
   */
  validateCommand(command: string): ValidationResult {
    // Refresh guard with latest config before validation
    this.commandGuard.updateConfig(this.getConfig());
    return this.commandGuard.validateCommand(command);
  }

  /**
   * Get default timeout from config.
   */
  getDefaultTimeout(): number {
    return this.getConfig().defaultTimeoutMs;
  }

  /**
   * Get the number of active sessions.
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Find a session by its VSCode terminal instance.
   */
  findByTerminal(terminal: vscode.Terminal): TerminalSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.getTerminal() === terminal) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Dispose all sessions and cleanup.
   */
  dispose(): void {
    if (this.idleReaperInterval) {
      clearInterval(this.idleReaperInterval);
      this.idleReaperInterval = null;
    }

    for (const [id, session] of this.sessions) {
      session.dispose();
    }
    this.sessions.clear();
    this.onSessionsChangedEmitter.dispose();

    log("SessionManager disposed");
  }
}
