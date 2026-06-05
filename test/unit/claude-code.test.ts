import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureClaudeCode,
  restoreClaudeCode,
} from "../../src/integrations/claude-code/index.js";
import { decideClaudeBashCommand } from "../../src/integrations/claude-code/hook-policy.js";

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bashterm-claude-"));
  cleanupDirs.push(home);
  return home;
}

function readSettings(home: string): Record<string, unknown> {
  const settingsPath = path.join(home, ".claude", "settings.json");
  return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
}

describe("Claude Code integration", () => {
  it("creates settings and hook script when settings do not exist", () => {
    const home = createHome();

    const result = configureClaudeCode({ homeDir: home });

    expect(result.status).toBe("configured");
    expect(result.changed).toBe(true);
    expect(fs.existsSync(result.settingsPath)).toBe(true);
    expect(fs.existsSync(result.hookScriptPath)).toBe(true);

    const settings = readSettings(home);
    const preToolUse = (settings.hooks as { PreToolUse: unknown[] })
      .PreToolUse;
    expect(preToolUse).toHaveLength(1);
    expect(JSON.stringify(preToolUse[0])).toContain(
      "bashterm-mcp-bash-hook.js",
    );

    const scriptBytes = fs.readFileSync(result.hookScriptPath);
    expect(scriptBytes.subarray(0, 3)).not.toEqual(
      Buffer.from([0xef, 0xbb, 0xbf]),
    );
  });

  it("merges hook without overwriting user settings", () => {
    const home = createHome();
    const claudeDir = path.join(home, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        hooks: {
          PreToolUse: [
            {
              matcher: "Read",
              hooks: [{ type: "command", command: "node custom.js" }],
            },
          ],
        },
      }),
    );

    configureClaudeCode({ homeDir: home });

    const settings = readSettings(home);
    expect(settings.theme).toBe("dark");
    const preToolUse = (settings.hooks as { PreToolUse: unknown[] })
      .PreToolUse;
    expect(preToolUse).toHaveLength(2);
    expect(JSON.stringify(preToolUse)).toContain("node custom.js");
    expect(JSON.stringify(preToolUse)).toContain("bashterm-mcp-bash-hook.js");
  });

  it("does not overwrite settings when JSON parsing fails", () => {
    const home = createHome();
    const claudeDir = path.join(home, ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, "{ invalid json", "utf8");

    const result = configureClaudeCode({ homeDir: home });

    expect(result.status).toBe("error");
    expect(fs.readFileSync(settingsPath, "utf8")).toBe("{ invalid json");
    expect(fs.existsSync(result.hookScriptPath)).toBe(false);
  });

  it("restores only BashTerm MCP hooks", () => {
    const home = createHome();
    configureClaudeCode({ homeDir: home });
    const settings = readSettings(home);
    const hooks = settings.hooks as { PreToolUse: unknown[] };
    hooks.PreToolUse.unshift({
      matcher: "Bash",
      hooks: [{ type: "command", command: "node user-hook.js" }],
    });
    fs.writeFileSync(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify(settings, null, 2),
    );

    const result = restoreClaudeCode({ homeDir: home });

    expect(result.status).toBe("disabled");
    expect(result.changed).toBe(true);
    expect(fs.existsSync(result.hookScriptPath)).toBe(false);
    const restored = readSettings(home);
    expect(JSON.stringify(restored)).toContain("node user-hook.js");
    expect(JSON.stringify(restored)).not.toContain(
      "bashterm-mcp-bash-hook.js",
    );
  });

  it("removes an orphan hook script when settings are missing", () => {
    const home = createHome();
    const claudeDir = path.join(home, ".claude");
    const hookScriptPath = path.join(claudeDir, "bashterm-mcp-bash-hook.js");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(hookScriptPath, "console.log('orphan');", "utf8");

    const result = restoreClaudeCode({ homeDir: home });

    expect(result.status).toBe("disabled");
    expect(result.changed).toBe(false);
    expect(fs.existsSync(hookScriptPath)).toBe(false);
  });
});

describe("Claude Bash hook policy", () => {
  it("allows simple read-only commands", () => {
    expect(decideClaudeBashCommand("pwd").allowBuiltInBash).toBe(true);
    expect(decideClaudeBashCommand("rg TODO src").allowBuiltInBash).toBe(true);
  });

  it("allows read-only git and version commands", () => {
    expect(decideClaudeBashCommand("git status").allowBuiltInBash).toBe(true);
    expect(decideClaudeBashCommand("node --version").allowBuiltInBash).toBe(
      true,
    );
  });

  it("blocks multi-line, redirected, and complex commands", () => {
    expect(decideClaudeBashCommand("echo one\necho two")).toMatchObject({
      allowBuiltInBash: false,
      reason: "multi-line command",
    });
    expect(decideClaudeBashCommand("echo hi > out.txt")).toMatchObject({
      allowBuiltInBash: false,
      reason: "contains redirection",
    });
    expect(decideClaudeBashCommand("npm test").allowBuiltInBash).toBe(false);
  });
});
