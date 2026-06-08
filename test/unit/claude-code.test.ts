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

function readMcpJson(home: string): Record<string, unknown> {
  const mcpJsonPath = path.join(home, ".claude", "mcp.json");
  return JSON.parse(fs.readFileSync(mcpJsonPath, "utf8"));
}

function writeMcpJsonFile(
  home: string,
  content: Record<string, unknown>,
): void {
  const claudeDir = path.join(home, ".claude");
  const mcpJsonPath = path.join(claudeDir, "mcp.json");
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  fs.writeFileSync(mcpJsonPath, JSON.stringify(content, null, 2), "utf8");
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

    // Verify mcp.json was created with BashTerm entry
    expect(fs.existsSync(result.mcpJsonPath)).toBe(true);
    const mcp = readMcpJson(home);
    const servers = mcp.mcpServers as Record<string, unknown>;
    expect(servers).toBeDefined();
    const bashTerm = servers["BashTerm"] as Record<string, unknown>;
    expect(bashTerm).toBeDefined();
    expect(bashTerm.type).toBe("stdio");
    expect(bashTerm.command).toBe("npx");
    expect(bashTerm.args).toEqual(["bashterm-mcp-server@latest"]);
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

  describe("mcp.json auto-configuration", () => {
    it("creates mcp.json with BashTerm entry when file does not exist", () => {
      const home = createHome();

      const result = configureClaudeCode({ homeDir: home });

      expect(result.status).toBe("configured");
      expect(fs.existsSync(result.mcpJsonPath)).toBe(true);

      const mcp = readMcpJson(home);
      const servers = mcp.mcpServers as Record<string, unknown>;
      expect(servers).toBeDefined();
      const bashTerm = servers["BashTerm"] as Record<string, unknown>;
      expect(bashTerm).toBeDefined();
      expect(bashTerm.command).toBe("npx");
      expect(bashTerm.args).toEqual(["bashterm-mcp-server@latest"]);
    });

    it("merges BashTerm into existing mcp.json without overwriting other servers", () => {
      const home = createHome();
      writeMcpJsonFile(home, {
        mcpServers: {
          OtherServer: {
            type: "stdio",
            command: "other-cmd",
            args: [],
            env: {},
          },
        },
      });

      configureClaudeCode({ homeDir: home });

      const mcp = readMcpJson(home);
      const servers = mcp.mcpServers as Record<string, unknown>;
      expect(Object.keys(servers)).toHaveLength(2);
      expect(servers["OtherServer"]).toBeDefined();
      expect(servers["BashTerm"]).toBeDefined();
    });

    it("updates existing BashTerm entry without touching other servers", () => {
      const home = createHome();
      writeMcpJsonFile(home, {
        mcpServers: {
          OtherServer: {
            type: "stdio",
            command: "other-cmd",
            args: [],
            env: {},
          },
          BashTerm: {
            type: "stdio",
            command: "old-command",
            args: ["old-arg"],
            env: {},
          },
        },
      });

      configureClaudeCode({ homeDir: home });

      const mcp = readMcpJson(home);
      const servers = mcp.mcpServers as Record<string, unknown>;
      expect(Object.keys(servers)).toHaveLength(2);
      const bashTerm = servers["BashTerm"] as Record<string, unknown>;
      expect(bashTerm.command).toBe("npx");
      expect(bashTerm.args).toEqual(["bashterm-mcp-server@latest"]);
    });

    it("survives corrupt mcp.json and still completes hook configuration", () => {
      const home = createHome();
      const claudeDir = path.join(home, ".claude");
      const mcpJsonPath = path.join(claudeDir, "mcp.json");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(mcpJsonPath, "{ not valid json", "utf8");

      const result = configureClaudeCode({ homeDir: home });

      // Hook configuration should still succeed
      expect(result.status).toBe("configured");
      expect(fs.existsSync(result.settingsPath)).toBe(true);
      // mcp.json should be overwritten with valid content
      const mcp = readMcpJson(home);
      const servers = mcp.mcpServers as Record<string, unknown>;
      expect(servers["BashTerm"]).toBeDefined();
    });

    it("recreates mcp.json on repeated configure even if hook already exists", () => {
      const home = createHome();

      // First call: creates everything
      configureClaudeCode({ homeDir: home });

      // Delete mcp.json to simulate missing config
      const mcpJsonPath = path.join(home, ".claude", "mcp.json");
      fs.unlinkSync(mcpJsonPath);

      // Second call: hook already configured, mcp.json is recreated
      const result = configureClaudeCode({ homeDir: home });

      expect(result.status).toBe("configured");
      expect(fs.existsSync(result.mcpJsonPath)).toBe(true);
      const mcp = readMcpJson(home);
      const servers = mcp.mcpServers as Record<string, unknown>;
      expect(servers["BashTerm"]).toBeDefined();
    });
  });

  describe("mcp.json restore", () => {
    it("removes BashTerm entry from mcp.json while keeping other servers", () => {
      const home = createHome();
      writeMcpJsonFile(home, {
        mcpServers: {
          OtherServer: {
            type: "stdio",
            command: "other-cmd",
            args: [],
            env: {},
          },
          BashTerm: {
            type: "stdio",
            command: "npx",
            args: ["bashterm-mcp-server@latest"],
            env: {},
          },
        },
      });
      // Also need settings with a BashTerm hook for restore to work
      const claudeDir = path.join(home, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, "settings.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  {
                    type: "command",
                    command:
                      'node "/home/test/bashterm-mcp-bash-hook.js"',
                  },
                ],
              },
            ],
          },
        }),
      );

      const result = restoreClaudeCode({ homeDir: home });

      expect(result.status).toBe("disabled");
      const mcp = readMcpJson(home);
      const servers = mcp.mcpServers as Record<string, unknown>;
      expect(servers["OtherServer"]).toBeDefined();
      expect(servers["BashTerm"]).toBeUndefined();
    });

    it("deletes mcp.json when BashTerm is the only server entry", () => {
      const home = createHome();
      writeMcpJsonFile(home, {
        mcpServers: {
          BashTerm: {
            type: "stdio",
            command: "npx",
            args: ["bashterm-mcp-server@latest"],
            env: {},
          },
        },
      });
      const claudeDir = path.join(home, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, "settings.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  {
                    type: "command",
                    command:
                      'node "/home/test/bashterm-mcp-bash-hook.js"',
                  },
                ],
              },
            ],
          },
        }),
      );

      restoreClaudeCode({ homeDir: home });

      const mcpJsonPath = path.join(home, ".claude", "mcp.json");
      expect(fs.existsSync(mcpJsonPath)).toBe(false);
    });
  });

  describe(".claude.json per-project configuration", () => {
    function readClaudeJson(home: string): Record<string, unknown> {
      const claudeJsonPath = path.join(home, ".claude.json");
      return JSON.parse(fs.readFileSync(claudeJsonPath, "utf8"));
    }

    const testWorkspace = "/tmp/test-workspace";

    it("writes BashTerm to project config in .claude.json", () => {
      const home = createHome();

      configureClaudeCode({
        homeDir: home,
        workspacePath: testWorkspace,
      });

      expect(fs.existsSync(path.join(home, ".claude.json"))).toBe(true);
      const data = readClaudeJson(home);
      const projects = data.projects as Record<string, unknown>;
      const prj = projects[testWorkspace] as Record<string, unknown>;
      const servers = prj.mcpServers as Record<string, unknown>;
      expect(servers["BashTerm"]).toBeDefined();
      const bt = servers["BashTerm"] as Record<string, unknown>;
      expect(bt.command).toBe("npx");
      expect(bt.args).toEqual(["bashterm-mcp-server@latest"]);
    });

    it("merges BashTerm into existing project config without overwriting", () => {
      const home = createHome();
      // Pre-create .claude.json with existing project data
      fs.writeFileSync(
        path.join(home, ".claude.json"),
        JSON.stringify({
          projects: {
            [testWorkspace]: {
              mcpServers: {
                OtherServer: {
                  type: "stdio",
                  command: "other",
                  args: [],
                  env: {},
                },
              },
              allowedTools: [],
            },
          },
        }),
      );

      configureClaudeCode({
        homeDir: home,
        workspacePath: testWorkspace,
      });

      const data = readClaudeJson(home);
      const projects = data.projects as Record<string, unknown>;
      const prj = projects[testWorkspace] as Record<string, unknown>;
      const servers = prj.mcpServers as Record<string, unknown>;
      expect(Object.keys(servers)).toHaveLength(2);
      expect(servers["OtherServer"]).toBeDefined();
      expect(servers["BashTerm"]).toBeDefined();
    });

    it("restore removes BashTerm from .claude.json project config", () => {
      const home = createHome();
      const claudeDir = path.join(home, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, "settings.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  {
                    type: "command",
                    command:
                      'node "/home/test/bashterm-mcp-bash-hook.js"',
                  },
                ],
              },
            ],
          },
        }),
      );
      fs.writeFileSync(
        path.join(home, ".claude.json"),
        JSON.stringify({
          projects: {
            [testWorkspace]: {
              mcpServers: {
                BashTerm: {
                  type: "stdio",
                  command: "npx",
                  args: ["bashterm-mcp-server@latest"],
                  env: {},
                },
                OtherServer: {
                  type: "stdio",
                  command: "other",
                  args: [],
                  env: {},
                },
              },
            },
          },
        }),
      );

      restoreClaudeCode({
        homeDir: home,
        workspacePath: testWorkspace,
      });

      const data = readClaudeJson(home);
      const projects = data.projects as Record<string, unknown>;
      const prj = projects[testWorkspace] as Record<string, unknown>;
      const servers = prj.mcpServers as Record<string, unknown>;
      expect(servers["BashTerm"]).toBeUndefined();
      expect(servers["OtherServer"]).toBeDefined();
      // mcpServers should not be deleted when other servers remain
      expect(Object.keys(servers)).toHaveLength(1);
    });

    it("removes mcpServers from project config when BashTerm is the only entry", () => {
      const home = createHome();
      const claudeDir = path.join(home, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, "settings.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  {
                    type: "command",
                    command:
                      'node "/home/test/bashterm-mcp-bash-hook.js"',
                  },
                ],
              },
            ],
          },
        }),
      );
      fs.writeFileSync(
        path.join(home, ".claude.json"),
        JSON.stringify({
          projects: {
            [testWorkspace]: {
              mcpServers: {
                BashTerm: {
                  type: "stdio",
                  command: "npx",
                  args: ["bashterm-mcp-server@latest"],
                  env: {},
                },
              },
            },
          },
        }),
      );

      restoreClaudeCode({
        homeDir: home,
        workspacePath: testWorkspace,
      });

      const data = readClaudeJson(home);
      const projects = data.projects as Record<string, unknown>;
      const prj = projects[testWorkspace] as Record<string, unknown>;
      expect(prj.mcpServers).toBeUndefined();
    });

    it("skips project config when workspacePath is empty", () => {
      const home = createHome();

      // Should still work without writing .claude.json
      const result = configureClaudeCode({ homeDir: home });

      expect(result.status).toBe("configured");
      expect(fs.existsSync(path.join(home, ".claude.json"))).toBe(false);
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
