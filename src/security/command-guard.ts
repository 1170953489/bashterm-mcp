import * as path from "path";
import type { SecurityConfig } from "../types/index.js";

/**
 * Validates commands against security rules.
 */
export class CommandGuard {
  constructor(private config: SecurityConfig) {}

  /**
   * Update the security configuration.
   */
  updateConfig(config: SecurityConfig): void {
    this.config = config;
  }

  /**
   * Validate a command string against the blocklist.
   * Returns { valid: true } or { valid: false, reason: string }.
   */
  validateCommand(command: string): { valid: boolean; reason?: string } {
    const trimmed = command.trim();

    if (!trimmed) {
      return { valid: false, reason: "Empty command" };
    }

    // Check against blocked commands
    for (const blocked of this.config.blockedCommands) {
      if (isBlockedByPattern(trimmed, blocked)) {
        return {
          valid: false,
          reason: `Command contains blocked pattern: "${blocked}"`,
        };
      }
    }

    // Check against allowed commands (if allowlist is configured)
    if (
      this.config.allowedCommands &&
      this.config.allowedCommands.length > 0
    ) {
      const isAllowed = this.config.allowedCommands.some((allowed) =>
        trimmed.startsWith(allowed),
      );
      if (!isAllowed) {
        return {
          valid: false,
          reason: `Command not in allowed commands list. Allowed prefixes: ${this.config.allowedCommands.join(", ")}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Validate a working directory against the allowed directories list.
   */
  validateDirectory(cwd: string): { valid: boolean; reason?: string } {
    if (this.config.allowedDirectories.length === 0) {
      return { valid: true }; // No restrictions
    }

    const resolvedCwd = path.resolve(cwd);
    const isAllowed = this.config.allowedDirectories.some((dir) =>
      resolvedCwd.startsWith(path.resolve(dir)),
    );

    if (!isAllowed) {
      return {
        valid: false,
        reason: `Directory "${cwd}" is not in the allowed directories: ${this.config.allowedDirectories.join(", ")}`,
      };
    }

    return { valid: true };
  }
}

/**
 * Check if a command matches a blocked pattern.
 *
 * Most patterns use substring matching (`includes`).  The ``rm -rf /`` pattern
 * uses prefix + next‑char inspection so that ``rm -rf /tmp/foo`` is allowed
 * while ``rm -rf /``, ``rm -rf /*``, and ``rm -rf / --no-preserve-root`` are
 * still blocked.
 */
function isBlockedByPattern(trimmed: string, pattern: string): boolean {
  if (pattern === "rm -rf /") {
    if (!trimmed.startsWith("rm -rf /")) return false;
    const after = trimmed.slice("rm -rf /".length);
    return (
      after.length === 0 ||
      after.startsWith(" ") ||
      after.startsWith("*")
    );
  }
  return trimmed.includes(pattern);
}
