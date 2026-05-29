# vscode-terminal-mcp

[![npm version](https://img.shields.io/npm/v/vscode-terminal-mcp.svg)](https://npmjs.org/package/vscode-terminal-mcp)

在 **VSCode 可见的终端标签页**中执行命令的 MCP 服务器，支持完整输出捕获。与内联执行不同，每个命令都在真正的终端中运行，你可以看到、滚动并与之交互。

> **Windows 兼容版本** — 本 fork 完整支持 Windows 平台，包括中文输出不乱码。

## 核心功能

- **可见终端**：命令在真实的 VSCode 终端标签页中运行，而非隐藏进程。你可以实时查看所有输出。
- **会话复用**：`run` 工具会自动复用空闲会话，仅在需要时创建新终端。
- **长时间运行支持**：使用 `waitForCompletion: false` 实现"发射后不管"模式，随后用 `read` 逐步获取输出。
- **子代理隔离**：通过 `agentId` 标记会话，将并行代理的工作负载彼此隔离。
- **跨平台**：支持 Windows、macOS、Linux。Windows 上中文输出自动解码不乱码。

## 环境要求

- VS Code 1.93+
- Node.js 20+

## 快速开始

### Claude Code

```bash
claude mcp add BashTerm -- npx vscode-terminal-mcp@latest
```

或使用本 fork 的 Windows 优化版本：

```bash
# 下载 .vsix 安装包
# 从 Release 页面下载 vscode-terminal-mcp-0.1.7.vsix
code --install-extension vscode-terminal-mcp-0.1.7.vsix

# 添加 MCP 服务器（使用本地扩展内置的 mcp-entry）
claude mcp add BashTerm -- node "C:\Users\<用户名>\.vscode\extensions\hcdb.vscode-terminal-mcp-0.1.7\dist\mcp-entry.js"
```

### VS Code / Copilot

在 `.vscode/mcp.json` 中添加：

```json
{
  "servers": {
    "BashTerm": {
      "type": "stdio",
      "command": "npx",
      "args": ["vscode-terminal-mcp@latest"]
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
      "args": ["-y", "vscode-terminal-mcp@latest"]
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
      "args": ["-y", "vscode-terminal-mcp@latest"]
    }
  }
}
```

</details>

### 你的第一个提示

安装完成后，试试问：

> 在终端中运行 `ls -la`

你应该能在 VSCode 中看到一个新的终端标签页打开，并显示命令输出。

## 工具

### 快速执行

| 工具 | 说明 |
|------|------|
| `run` | 一步创建（或复用）终端并执行命令，返回清洁输出和退出码。 |

### 会话管理

| 工具 | 说明 |
|------|------|
| `create` | 创建新的可见终端会话，返回 `sessionId`。 |
| `exec` | 在已有会话中执行命令并捕获输出。 |
| `read` | 分页读取会话输出，支持增量读取和 tail 模式（`offset: -N`）。 |
| `input` | 向交互式终端发送文本（用于提示、REPL、确认等）。 |
| `list` | 列出活动会话，可选按 `agentId` 过滤。 |
| `close` | 关闭终端会话及其 VSCode 标签页。 |

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

代理会：
1. 调用 `run` 设置 `waitForCompletion: false` —— 立即返回
2. 调用 `read` 设置 `offset: -10` 查看最后 10 行
3. 重复直到进程完成

### 交互式命令

对于需要用户输入的命令：

```
> 运行 npm init 并回答提示
```

代理会：
1. 调用 `run` 执行 `npm init`
2. 调用 `read` 查看提示
3. 调用 `input` 发送答案

### 并行代理

子代理可以使用 `agentId` 在隔离的终端中工作：

```
> 让一个代理运行测试，另一个运行代码检查
```

每个子代理获得自己的终端，标记其 `agentId`，防止输出混淆。

## 配置

扩展从 VSCode 设置中读取 `terminalMcp.*` 配置：

| 设置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `terminalMcp.maxSessions` | number | 10 | 最大并发终端会话数 |
| `terminalMcp.commandTimeout` | number | 30000 | 默认命令超时（毫秒） |
| `terminalMcp.maxOutputLines` | number | 5000 | 每个会话最大缓冲输出行数 |
| `terminalMcp.idleTimeout` | number | 1800000 | 空闲会话自动关闭时间（毫秒，0=禁用） |
| `terminalMcp.blockedCommands` | string[] | `["rm -rf /"]` | 禁止执行的命令列表 |

## 推荐：设为优先工具

像 Claude Code 这样的 LLM 代理内置了 `Bash` 工具，会在聊天中内联执行命令。输出嵌入在对话中，难以阅读，尤其是输出冗长的命令。**建议告诉代理优先使用本 MCP 工具，而非内置 Bash 工具。**

将以下内容添加到项目的 `CLAUDE.md`（或等效指令文件）中：

```markdown
## 终端执行

优先使用 BashTerm MCP 工具（`run`、`exec`、`read` 等）来执行命令，而不是使用内置的 Bash 工具。
BashTerm 在可见的 VSCode 终端标签页中运行命令，用户可以实时查看输出。
仅在简单、非交互式操作（如读取环境变量）时回退到内置 Bash 工具。

对于可能超过 30 秒或产生大量输出的命令（构建、测试套件、部署、安装），使用 pull 模式：
1. 调用 `run` 设置 `waitForCompletion: false` 启动命令但不阻塞。
2. 调用 `read` 设置 `offset: -10` 查看最后 10 行输出。
3. 重复步骤 2 直到看到命令完成（查找退出消息、提示或 "Done"）。
4. 向用户报告最终结果。

这样可以防止对话超时，并让用户实时观察终端进度。
```

**为什么重要：**

| | 内置 Bash | BashTerm MCP |
|---|---|---|
| 输出可见性 | 嵌入聊天，难以滚动 | 在 VSCode 终端标签页中可见 |
| 实时反馈 | 用户看不到任何输出直到命令完成 | 用户实时观看输出 |
| 长时间命令 | 阻塞对话直到超时 | 发射后不管 + 轮询 |
| 会话状态 | 每个命令隔离 | 持久化会话，带历史 |
| 交互式命令 | 不支持 | 可向提示/REPL 发送输入 |

## 工作方式

1. **VSCode 扩展**激活并启动 IPC 服务器（Windows 上使用 Named Pipe，其他平台使用 Unix Socket）
2. **MCP 入口**（`mcp-entry.js`）由 MCP 客户端启动，在 JSON-RPC stdio 和 IPC socket 之间建立桥接
3. 命令通过 `child_process.exec()` 执行，输出直接捕获，不再依赖 Shell Integration API
4. 输出存储在循环缓冲区中，支持分页高效读取

## 最新更新 (0.1.7)

- **Windows 平台完整支持**：IPC 改用 Windows Named Pipe，修复 `EACCES` 错误
- **中文不乱码**：Windows 下自动使用 GBK 解码输出
- **命令执行更可靠**：改用 `child_process.exec()` 直接执行命令，绕过 Shell Integration API 依赖

详见 [CHANGELOG.md](CHANGELOG.md) 查看完整历史。

## 许可证

MIT
