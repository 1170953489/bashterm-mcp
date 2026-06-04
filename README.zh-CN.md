# BashTerm

[![English](https://img.shields.io/badge/README-English-blue)](README.md) [![release](https://img.shields.io/npm/v/bashterm-mcp-server?label=release)](https://github.com/1170953489/bashterm-mcp/releases) [![npm version](https://img.shields.io/npm/v/bashterm-mcp-server)](https://www.npmjs.com/package/bashterm-mcp-server)

在 **VSCode 可见的终端标签页**中执行命令的 MCP 服务器——实时观看输出、滚动历史、按需交互。

## 核心功能

- **可见终端**：命令在真实的 VSCode 终端标签页中运行——实时观看输出、滚动历史、按需交互。
- **会话复用**：`run` 自动复用空闲会话，仅在必要时创建新终端。
- **非阻塞执行**：`waitForCompletion: false` 发射后不管，随后用 `read` 轮询。
- **子代理隔离**：通过 `agentId` 标记会话，将并行代理的工作负载隔离在独立终端中。

## 环境要求

- VS Code 1.93+
- Node.js 20+

## 快速开始

### Claude Code

```bash
claude mcp add BashTerm -- npx bashterm-mcp-server@latest
```

### VS Code / Copilot

在 `.vscode/mcp.json` 中添加：

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

在 `.cursor/mcp.json` 中添加：

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

在 `claude_desktop_config.json` 中添加：

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

## 截图

![Run command output](docs/images/run_finished.png)
![Exec permission dialog](docs/images/ask_exec_permission.png)
![Exec finished](docs/images/exec_finished.png)

## 工具

### 快速执行

| 工具 | 说明 |
|------|------|
| `run` | 一步创建（或复用）终端并执行命令，返回清洁输出和退出码。 |

### 会话管理

| 工具 | 说明 |
|------|------|
| `create` | 打开新的可见终端标签页，返回 `sessionId`。 |
| `exec` | 在已有会话中执行命令并捕获输出。 |
| `read` | 基于偏移量分页读取会话输出。使用 `offset: -N` 进入 tail 模式。 |
| `input` | 向交互式进程发送文本（回答提示、驱动 REPL、确认操作）。 |
| `list` | 列出活动会话，可按 `agentId` 过滤。 |
| `close` | 关闭会话及其终端标签页。 |

## 使用模式

### 简单命令

`run` 工具处理一切——按需创建终端、执行命令、返回清洁输出：

```
> 运行 npm test
```

```
$ npm test
PASS src/utils.test.ts (3 tests)
PASS src/index.test.ts (5 tests)

[exit: 0 | 1243ms | session-abc123]
```

### 长时间运行

对于构建、部署或其他耗时命令：

```
> 启动 npm run build 不等待，然后检查进度
```

代理使用 `waitForCompletion: false` 启动命令（立即返回），然后通过 `read`（`offset: -10`）轮询直到进程完成。

### 交互式命令

对于需要用户输入的命令：

```
> 运行 npm init 并回答提示
```

代理使用 `run` 启动命令、`read` 查看提示、`input` 发送响应——逐步驱动交互式进程。

### 并行代理

子代理可以使用 `agentId` 在隔离的终端中工作：

```
> 让一个代理运行测试，另一个运行代码检查
```

每个子代理获得独立的终端，标记其 `agentId`，保持输出分离且可读。

## 配置

扩展从 VSCode 设置中读取 `bashterm-mcp-server.*` 配置：

| 设置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `bashterm-mcp-server.maxSessions` | number | 10 | 最大并发终端会话数 |
| `bashterm-mcp-server.commandTimeout` | number | 30000 | 默认命令超时（毫秒） |
| `bashterm-mcp-server.maxOutputLines` | number | 5000 | 每个会话最大缓冲输出行数 |
| `bashterm-mcp-server.idleTimeout` | number | 1800000 | 空闲会话自动关闭时间（毫秒，0=禁用） |
| `bashterm-mcp-server.blockedCommands` | string[] | `["rm -rf /"]` | 禁止执行的命令列表 |

## 推荐

LLM 代理内置的 `Bash` 工具将输出内联在对话中，难以翻阅。建议优先使用 BashTerm MCP 在可见终端中执行命令。将以下内容添加到项目的 `CLAUDE.md`：

```markdown
## 终端执行
优先使用 BashTerm MCP 工具（`run`、`exec`、`read` 等），而非内置 Bash 工具。
对于超过 30 秒的命令，使用 pull 模式：`run` 设置 `waitForCompletion: false`，随后用 `read`（`offset: -10`）轮询。
```

## 许可证

MIT
