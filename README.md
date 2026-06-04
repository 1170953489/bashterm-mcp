# BashTerm MCP

[![中文文档](https://img.shields.io/badge/README-中文-red)](README.zh-CN.md) [![release](https://img.shields.io/npm/v/bashterm-mcp-server?label=release)](https://github.com/1170953489/bashterm-mcp/releases) [![npm version](https://img.shields.io/npm/v/bashterm-mcp-server)](https://www.npmjs.com/package/bashterm-mcp-server)

Run AI-generated shell commands in **real, visible VSCode terminals**.

BashTerm MCP turns Claude Code command execution into something you can see, inspect, interrupt, and continue. Instead of hidden shell calls, commands open in normal VSCode terminal tabs with live output, scrollback, interactive input, reusable sessions, and safety controls.

## Why BashTerm MCP

- **Visible by default**: Every command runs in a real VSCode terminal tab, so you can watch builds, tests, logs, and failures as they happen.
- **Claude Code ready**: The extension registers its MCP server automatically and can guide Claude Code away from the hidden built-in `Bash` tool.
- **Long-task friendly**: Start commands without blocking the agent, then read output incrementally while the process keeps running.
- **Interactive when needed**: Answer prompts, drive REPLs, confirm commands, or send Ctrl+C-style input through the same terminal session.
- **Session reuse**: Keep context in a terminal instead of creating a fresh process for every command.
- **Parallel-agent isolation**: Use `agentId` to keep multiple AI workers in separate, readable terminals.
- **Practical guardrails**: Block dangerous command prefixes, restrict working directories, cap output buffers, and auto-close idle sessions.
- **Safe rollback**: Disable the Claude Code auto-hook or run a restore command to return to Claude Code's default Bash behavior.

## Install

1. Install **BashTerm MCP** from the [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=hcdb.bashterm-mcp-server).
2. Open VSCode.
3. Use Claude Code normally.

The extension automatically registers the MCP server through `contributes.mcpServers`, so tools such as `run`, `exec`, `read`, and `input` are available without manual MCP JSON setup.

## Claude Code Integration

BashTerm MCP can write a user-level PreToolUse hook to `~/.claude/settings.json`. That hook blocks Claude Code's built-in hidden `Bash` tool and tells Claude Code to use BashTerm MCP tools instead, keeping command execution visible inside VSCode.

You stay in control:

- Turn it off with `bashterm-mcp-server.autoConfigureClaudeCode`.
- Restore default Bash with `BashTerm MCP: Restore Claude Code Default Bash` from the Command Palette.
- Disable or uninstall the extension safely: it removes its own Claude Code hook during deactivation.

## Screenshots

![Run command output](docs/images/run_finished.png)
![Exec permission dialog](docs/images/ask_exec_permission.png)
![Exec finished](docs/images/exec_finished.png)

## Common Workflows

### Run a Command

Ask Claude Code:

```text
Run npm test
```

BashTerm MCP creates or reuses a visible terminal, runs the command, and returns clean output with the exit code.

### Watch a Long Build

```text
Start npm run build without waiting, then monitor progress
```

The agent can launch the command with `waitForCompletion: false`, then poll output with `read` while you watch the same terminal live in VSCode.

### Handle Interactive Prompts

```text
Run npm init and answer the prompts
```

The agent can start the process, read the prompt, send input, and continue step by step in the visible terminal.

### Separate Parallel Agents

```text
Have one agent run tests while another runs the linter
```

Each agent can receive its own `agentId`, keeping terminal sessions and output streams separate.

## Tools

| Tool | What it does |
|------|--------------|
| `run` | Create or reuse a terminal and run a command in one step. |
| `create` | Open a visible terminal tab and return a `sessionId`. |
| `exec` | Run a command in an existing session and capture output. |
| `read` | Read session output with offset-based pagination or tail mode. |
| `input` | Send text to an interactive process. |
| `list` | List active sessions, optionally filtered by `agentId`. |
| `close` | Close a session and its terminal tab. |

## Configuration

Configure BashTerm MCP from VSCode settings under `bashterm-mcp-server.*`.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `bashterm-mcp-server.autoConfigureClaudeCode` | boolean | `true` | Automatically configure Claude Code to prefer BashTerm MCP over the built-in `Bash` tool. |
| `bashterm-mcp-server.blockedCommands` | string[] | `["rm -rf /", "mkfs", "dd if=", ":(){ :|:& };:"]` | Command prefixes that are always rejected. |
| `bashterm-mcp-server.allowedDirectories` | string[] | `[]` | Allowed working directories. Empty means unrestricted. |
| `bashterm-mcp-server.defaultTimeoutMs` | number | `30000` | Default command timeout in milliseconds. |
| `bashterm-mcp-server.maxConcurrentSessions` | number | `10` | Maximum number of concurrent terminal sessions. |
| `bashterm-mcp-server.maxOutputLines` | number | `10000` | Maximum output lines buffered per session. |
| `bashterm-mcp-server.idleTimeoutMs` | number | `300000` | Auto-close idle sessions after this many milliseconds. `0` disables it. |
| `bashterm-mcp-server.windowsDefaultShell` | string | `"vscode"` | Default shell for Windows when no shell is explicitly requested. Options: `vscode`, `cmd`, `powershell`, `pwsh`. |
| `bashterm-mcp-server.windowsShellDetection` | boolean | `true` | Automatically route high-confidence Windows commands to cmd or PowerShell for the `run` tool. |

## Requirements

- VSCode 1.99+
- Node.js 20+
- Claude Code or another MCP-capable client

## When It Helps Most

BashTerm MCP is especially useful when the agent needs to run commands you care about observing: tests, package installs, dev servers, migrations, scaffolding tools, deploy scripts, and any command that might ask for input or run longer than a few seconds.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

MIT
