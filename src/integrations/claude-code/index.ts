import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  CLAUDE_CODE_HOOK_SCRIPT_NAME,
  createClaudeCodeHookScript,
} from "./hook-script.js";

export type ClaudeCodeConfigureStatus =
  | "configured"
  | "unchanged"
  | "disabled"
  | "error";

export interface ClaudeCodeConfigureResult {
  status: ClaudeCodeConfigureStatus;
  changed: boolean;
  settingsPath: string;
  hookScriptPath: string;
  mcpJsonPath: string;
  error?: string;
}

export interface ClaudeCodeOptions {
  homeDir?: string;
  workspacePath?: string;
}

interface ClaudeCodePaths {
  homeDir: string;
  claudeDir: string;
  settingsPath: string;
  hookScriptPath: string;
  mcpJsonPath: string;
  claudeJsonPath: string;
}

interface ReadSettingsResult {
  settings: Record<string, unknown>;
  parseError?: string;
}

export function configureClaudeCode(
  options: ClaudeCodeOptions = {},
): ClaudeCodeConfigureResult {
  const { workspacePath = "" } = options;
  const paths = getClaudeCodePaths(options.homeDir, workspacePath);
  const readResult = readClaudeCodeSettings(paths.settingsPath);
  if (readResult.parseError) {
    return result("error", paths, false, readResult.parseError);
  }

  const settings = readResult.settings;
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  const existingPreToolUse = Array.isArray(hooks.PreToolUse)
    ? hooks.PreToolUse
    : [];
  const preToolUse = existingPreToolUse.filter(
    (hook): hook is Record<string, unknown> =>
      isRecord(hook) && !isBashTermClaudeCodeHook(hook),
  );

  const needsCleanup = preToolUse.length !== existingPreToolUse.length;
  const alreadyConfigured =
    !needsCleanup && existingPreToolUse.some(isCurrentBashTermClaudeCodeHook);

  try {
    writeClaudeCodeHookScript(paths.claudeDir, paths.hookScriptPath);
    writeMcpJson(paths.claudeDir, paths.mcpJsonPath);
    writeProjectClaudeJson(paths.claudeJsonPath, workspacePath);

    if (alreadyConfigured) {
      return result("unchanged", paths, false);
    }

    preToolUse.push(createClaudeCodeHook(paths.hookScriptPath));
    hooks.PreToolUse = preToolUse;
    settings.hooks = hooks;
    writeClaudeCodeSettings(paths.claudeDir, paths.settingsPath, settings);
    return result("configured", paths, true);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return result("error", paths, false, error);
  }
}

export function restoreClaudeCode(
  options: ClaudeCodeOptions = {},
): ClaudeCodeConfigureResult {
  const { workspacePath = "" } = options;
  const paths = getClaudeCodePaths(options.homeDir, workspacePath);
  if (!fs.existsSync(paths.settingsPath)) {
    removeHookScript(paths.hookScriptPath);
    return result("disabled", paths, false);
  }

  const readResult = readClaudeCodeSettings(paths.settingsPath);
  if (readResult.parseError) {
    return result("error", paths, false, readResult.parseError);
  }

  const settings = readResult.settings;
  if (!isRecord(settings.hooks)) {
    removeHookScript(paths.hookScriptPath);
    return result("disabled", paths, false);
  }

  const hooks = settings.hooks;
  const existingPreToolUse = Array.isArray(hooks.PreToolUse)
    ? hooks.PreToolUse
    : [];
  const preToolUse = existingPreToolUse.filter(
    (hook) => !isBashTermClaudeCodeHook(hook),
  );
  if (preToolUse.length === existingPreToolUse.length) {
    removeHookScript(paths.hookScriptPath);
    return result("disabled", paths, false);
  }

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
    writeClaudeCodeSettings(paths.claudeDir, paths.settingsPath, settings);
    removeHookScript(paths.hookScriptPath);
    restoreMcpJson(paths.mcpJsonPath);
    restoreProjectClaudeJson(paths.claudeJsonPath, workspacePath);
    return result("disabled", paths, true);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return result("error", paths, false, error);
  }
}

function getClaudeCodePaths(
  homeDir = os.homedir(),
  workspacePath = "",
): ClaudeCodePaths {
  const claudeDir = path.join(homeDir, ".claude");
  return {
    homeDir,
    claudeDir,
    settingsPath: path.join(claudeDir, "settings.json"),
    hookScriptPath: path.join(claudeDir, CLAUDE_CODE_HOOK_SCRIPT_NAME),
    mcpJsonPath: path.join(claudeDir, "mcp.json"),
    claudeJsonPath: path.join(homeDir, ".claude.json"),
  };
}

function result(
  status: ClaudeCodeConfigureStatus,
  paths: ClaudeCodePaths,
  changed: boolean,
  error?: string,
): ClaudeCodeConfigureResult {
  return {
    status,
    changed,
    settingsPath: paths.settingsPath,
    hookScriptPath: paths.hookScriptPath,
    mcpJsonPath: paths.mcpJsonPath,
    error,
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
      (handler.command.includes("BashTerm MCP") ||
        handler.command.includes(CLAUDE_CODE_HOOK_SCRIPT_NAME)),
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

function readClaudeCodeSettings(settingsPath: string): ReadSettingsResult {
  if (!fs.existsSync(settingsPath)) {
    return { settings: {} };
  }

  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    return { settings: JSON.parse(raw) };
  } catch (err) {
    return {
      settings: {},
      parseError: err instanceof Error ? err.message : String(err),
    };
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

  const tempPath = `${settingsPath}.tmp-${process.pid}-${Date.now()}`;
  const content = JSON.stringify(settings, null, 2) + "\n";
  try {
    fs.writeFileSync(tempPath, Buffer.from(content, "utf8"));
    fs.renameSync(tempPath, settingsPath);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Ignore temporary file cleanup errors.
    }
  }
}

function writeClaudeCodeHookScript(
  claudeDir: string,
  scriptPath: string,
): void {
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  fs.writeFileSync(
    scriptPath,
    Buffer.from(createClaudeCodeHookScript() + "\n", "utf8"),
    { mode: 0o755 },
  );
}

function removeHookScript(scriptPath: string): void {
  try {
    fs.unlinkSync(scriptPath);
  } catch {
    // Ignore missing hook script or cleanup errors.
  }
}

const MCP_SERVER_ENTRY: Record<string, unknown> = {
  type: "stdio",
  command: "npx",
  args: ["bashterm-mcp-server@latest"],
  env: {},
};

function writeMcpJson(claudeDir: string, mcpJsonPath: string): void {
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  const existing: Record<string, unknown> = (() => {
    if (!fs.existsSync(mcpJsonPath)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(mcpJsonPath, "utf-8");
      const parsed = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  })();

  const servers = isRecord(existing.mcpServers) ? existing.mcpServers : {};
  servers["BashTerm"] = MCP_SERVER_ENTRY;
  existing.mcpServers = servers;

  const tempPath = `${mcpJsonPath}.tmp-${process.pid}-${Date.now()}`;
  const content = JSON.stringify(existing, null, 2) + "\n";
  try {
    fs.writeFileSync(tempPath, Buffer.from(content, "utf8"));
    fs.renameSync(tempPath, mcpJsonPath);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Ignore temporary file cleanup errors.
    }
  }
}

function restoreMcpJson(mcpJsonPath: string): void {
  if (!fs.existsSync(mcpJsonPath)) {
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    const raw = fs.readFileSync(mcpJsonPath, "utf-8");
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    return;
  }

  const servers = parsed.mcpServers as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(servers, "BashTerm")) {
    return;
  }

  delete servers["BashTerm"];

  if (Object.keys(servers).length === 0) {
    // Remove mcp.json entirely if no MCP servers remain
    try {
      fs.unlinkSync(mcpJsonPath);
    } catch {
      // Ignore cleanup errors.
    }
  } else {
    parsed.mcpServers = servers;
    const tempPath = `${mcpJsonPath}.tmp-${process.pid}-${Date.now()}`;
    const content = JSON.stringify(parsed, null, 2) + "\n";
    try {
      fs.writeFileSync(tempPath, Buffer.from(content, "utf8"));
      fs.renameSync(tempPath, mcpJsonPath);
    } finally {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // Ignore temporary file cleanup errors.
      }
    }
  }
}

function writeProjectClaudeJson(
  claudeJsonPath: string,
  workspacePath: string,
): void {
  if (!workspacePath) return;

  const existing: Record<string, unknown> = (() => {
    if (!fs.existsSync(claudeJsonPath)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(claudeJsonPath, "utf-8");
      const parsed = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  })();

  const projects = isRecord(existing.projects) ? existing.projects : {};
  const projectConfig = isRecord(projects[workspacePath])
    ? (projects[workspacePath] as Record<string, unknown>)
    : {};

  const servers = isRecord(projectConfig.mcpServers)
    ? projectConfig.mcpServers
    : {};
  servers["BashTerm"] = MCP_SERVER_ENTRY;
  projectConfig.mcpServers = servers;
  projects[workspacePath] = projectConfig;
  existing.projects = projects;

  const tempPath = `${claudeJsonPath}.tmp-${process.pid}-${Date.now()}`;
  const content = JSON.stringify(existing, null, 2) + "\n";
  try {
    fs.writeFileSync(tempPath, Buffer.from(content, "utf8"));
    fs.renameSync(tempPath, claudeJsonPath);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Ignore temporary file cleanup errors.
    }
  }
}

function restoreProjectClaudeJson(
  claudeJsonPath: string,
  workspacePath: string,
): void {
  if (!workspacePath || !fs.existsSync(claudeJsonPath)) return;

  let parsed: Record<string, unknown>;
  try {
    const raw = fs.readFileSync(claudeJsonPath, "utf-8");
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (!isRecord(parsed) || !isRecord(parsed.projects)) return;

  const projects = parsed.projects as Record<string, unknown>;
  const projectConfig = projects[workspacePath];
  if (!isRecord(projectConfig)) return;

  const servers = (projectConfig as Record<string, unknown>).mcpServers;
  if (!isRecord(servers) || !Object.prototype.hasOwnProperty.call(servers, "BashTerm")) {
    return;
  }

  delete servers["BashTerm"];

  if (Object.keys(servers).length === 0) {
    delete (projectConfig as Record<string, unknown>).mcpServers;
  }

  const tempPath = `${claudeJsonPath}.tmp-${process.pid}-${Date.now()}`;
  const content = JSON.stringify(parsed, null, 2) + "\n";
  try {
    fs.writeFileSync(tempPath, Buffer.from(content, "utf8"));
    fs.renameSync(tempPath, claudeJsonPath);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Ignore temporary file cleanup errors.
    }
  }
}

function createClaudeCodeHook(scriptPath: string): Record<string, unknown> {
  return {
    matcher: "Bash",
    hooks: [
      {
        type: "command",
        command: `node ${quoteHookCommandPath(scriptPath)}`,
      },
    ],
  };
}

function quoteHookCommandPath(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
