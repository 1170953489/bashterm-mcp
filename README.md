# BashTerm

[![中文文档](https://img.shields.io/badge/README-中文-red)](README.zh-CN.md) [![release](https://img.shields.io/npm/v/bashterm-mcp-server?label=release)](https://github.com/1170953489/bashterm-mcp/releases) [![npm version](https://img.shields.io/npm/v/bashterm-mcp-server)](https://www.npmjs.com/package/bashterm-mcp-server)

MCP server that runs shell commands in **visible VSCode terminal tabs** — watch output live, scroll history, interact when needed.

## Key Features

- **Visible Terminals**: Commands run in real VSCode terminal tabs — watch output live, scroll history, interact when needed.
- **Session Reuse**: `run` automatically reuses idle sessions, creating new terminals only when necessary.
- **Non-Blocking Execution**: Fire-and-forget with `waitForCompletion: false`, then poll with `read`.
- **Subagent Isolation**: Tag sessions with `agentId` to keep parallel agent workloads in separate terminals.

## Requirements

- VS Code 1.93+
- Node.js 20+

## Getting Started

### Claude Code

```bash
claude mcp add BashTerm -- npx bashterm-mcp-server@latest
```

### VS Code / Copilot

Add to your `.vscode/mcp.json`:

```json
{
  "servers": {
    "BashTerm": {
      "type": "stdio",
      "command": "npx",
      "args": ["bashterm-mcp-server@latest"]
    }
  }
}
```

<details>
<summary>Cursor</summary>

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "BashTerm": {
      "command": "npx",
      "args": ["-y", "bashterm-mcp-server@latest"]
    }
  }
}
```

</details>

<details>
<summary>Claude Desktop</summary>

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "BashTerm": {
      "command": "npx",
      "args": ["-y", "bashterm-mcp-server@latest"]
    }
  }
}
```

</details>

## Screenshots

![Run command output](docs/images/run_finished.png)
![Exec permission dialog](docs/images/ask_exec_permission.png)
![Exec finished](docs/images/exec_finished.png)

## Tools

### Quick Execution

| Tool | Description |
|------|-------------|
| `run` | Create (or reuse) a terminal and execute a command in one step. Returns clean output with exit code. |

### Session Management

| Tool | Description |
|------|-------------|
| `create` | Open a new visible terminal tab and return a `sessionId`. |
| `exec` | Run a command in an existing session and capture its output. |
| `read` | Read session output with offset-based pagination. Use `offset: -N` for tail mode. |
| `input` | Send text to an interactive process (answer prompts, drive REPLs, confirm actions). |
| `list` | List active sessions, optionally filtered by `agentId`. |
| `close` | Close a session and its terminal tab. |

## Usage Patterns

### Simple Command

The `run` tool handles everything — creates a terminal if needed, executes, and returns clean output:

```
> Run npm test
```

```
$ npm test
PASS src/utils.test.ts (3 tests)
PASS src/index.test.ts (5 tests)

[exit: 0 | 1243ms | session-abc123]
```

### Long-Running Process

For builds, deployments, or any command that takes a while:

```
> Start `npm run build` without waiting, then check progress
```

The agent launches the command with `waitForCompletion: false` (returns immediately), then polls with `read` (`offset: -10`) until the process finishes.

### Interactive Commands

For commands that need user input:

```
> Run npm init and answer the prompts
```

The agent uses `run` to start the command, `read` to check the prompt, and `input` to send responses — driving the interactive process step by step.

### Parallel Agents

Subagents can work in isolated terminals using `agentId`:

```
> Have one agent run tests while another runs the linter
```

Each subagent gets its own terminal tagged with its `agentId`, keeping output separate and readable.

## Configuration

The extension reads configuration from VSCode settings under `bashterm-mcp-server.*`:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `bashterm-mcp-server.maxSessions` | number | 10 | Maximum concurrent terminal sessions |
| `bashterm-mcp-server.commandTimeout` | number | 30000 | Default command timeout in ms |
| `bashterm-mcp-server.maxOutputLines` | number | 5000 | Max lines kept in output buffer per session |
| `bashterm-mcp-server.idleTimeout` | number | 1800000 | Close idle sessions after this many ms (0 = disabled) |
| `bashterm-mcp-server.blockedCommands` | string[] | `["rm -rf /"]` | Commands that will be rejected |

## Recommended

LLM agents include a built-in `Bash` tool that runs commands inline, embedding output in the conversation. Prefer BashTerm MCP for visible, scrollable terminal output. Add this to your project's `CLAUDE.md`:

```markdown
## Terminal Execution
Prefer the BashTerm MCP tools (`run`, `exec`, `read`, etc.) over the built-in Bash tool.
BashTerm runs commands in visible VSCode terminal tabs where you can see output in real time.
For commands over 30 seconds, use pull mode: `run` with `waitForCompletion: false`, then poll with `read` (`offset: -10`).
```

## License

MIT
