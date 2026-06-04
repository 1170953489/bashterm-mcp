# BashTerm MCP

[![English](https://img.shields.io/badge/README-English-blue)](README.md) [![release](https://img.shields.io/npm/v/bashterm-mcp-server?label=release)](https://github.com/1170953489/bashterm-mcp/releases) [![npm version](https://img.shields.io/npm/v/bashterm-mcp-server)](https://www.npmjs.com/package/bashterm-mcp-server)

让 AI 生成的 shell 命令在 **真实可见的 VSCode 终端**里运行。

BashTerm MCP 把 Claude Code 的命令执行变成你能看见、能检查、能中断、能继续交互的过程。不再是隐藏的后台 Bash 调用，而是普通 VSCode 终端标签页：实时输出、历史滚动、交互输入、会话复用和安全控制都在你眼前。

## 为什么选择 BashTerm MCP

- **默认可见**：每条命令都在真实 VSCode 终端标签页中运行，测试、构建、日志和报错都能实时看到。
- **开箱支持 Claude Code**：扩展会自动注册 MCP server，并可引导 Claude Code 使用 BashTerm MCP 替代隐藏的内置 `Bash`。
- **适合长任务**：命令可以非阻塞启动，进程持续运行时再增量读取输出。
- **支持交互命令**：可以回答提示、驱动 REPL、确认操作，或向同一个终端会话继续发送输入。
- **会话复用**：复用已有终端上下文，减少每条命令都新开进程带来的割裂感。
- **并行代理隔离**：通过 `agentId` 让多个 AI worker 使用不同终端，输出清晰不串台。
- **实用安全边界**：支持危险命令前缀拦截、工作目录限制、输出缓冲上限和空闲会话自动关闭。
- **可安全回退**：可关闭 Claude Code 自动 hook，或一键恢复 Claude Code 默认 Bash 行为。

## 安装

1. 从 [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=hcdb.bashterm-mcp-server) 安装 **BashTerm MCP**。
2. 打开 VSCode。
3. 正常使用 Claude Code。

扩展会通过 `contributes.mcpServers` 自动注册 MCP server，`run`、`exec`、`read`、`input` 等工具无需手写 MCP JSON 配置即可使用。

## Claude Code 集成

BashTerm MCP 可以向用户级 `~/.claude/settings.json` 写入 PreToolUse hook。这个 hook 会拦截 Claude Code 隐藏的内置 `Bash` 工具，并提示 Claude Code 改用 BashTerm MCP 工具，让命令执行保持在 VSCode 可见终端中。

控制权始终在用户手里：

- 关闭 `bashterm-mcp-server.autoConfigureClaudeCode` 即可停用自动 hook。
- 在命令面板执行 `BashTerm MCP: Restore Claude Code Default Bash` 可恢复默认 Bash。
- 直接禁用或卸载扩展也安全：扩展停用时会移除自己写入的 Claude Code hook。

## 截图

![Run command output](docs/images/run_finished.png)
![Exec permission dialog](docs/images/ask_exec_permission.png)
![Exec finished](docs/images/exec_finished.png)

## 常见使用场景

### 运行普通命令

告诉 Claude Code：

```text
运行 npm test
```

BashTerm MCP 会创建或复用一个可见终端，执行命令，并返回清洁输出和退出码。

### 观察长时间构建

```text
启动 npm run build，不要等待结束，然后持续查看进度
```

代理可以用 `waitForCompletion: false` 启动命令，再通过 `read` 轮询输出；同时你也能在 VSCode 终端里实时观察同一个进程。

### 处理交互式提示

```text
运行 npm init 并回答提示
```

代理可以启动进程、读取提示、发送输入，然后一步步驱动交互式命令。

### 隔离并行代理

```text
让一个代理跑测试，另一个代理跑 lint
```

每个代理都可以带上自己的 `agentId`，终端会话和输出流彼此分离。

## 工具列表

| 工具 | 功能 |
|------|------|
| `run` | 创建或复用终端，并一步执行命令。 |
| `create` | 打开可见终端标签页并返回 `sessionId`。 |
| `exec` | 在已有会话中执行命令并捕获输出。 |
| `read` | 按偏移量分页读取输出，或进入 tail 模式。 |
| `input` | 向交互式进程发送文本。 |
| `list` | 列出活动会话，可按 `agentId` 过滤。 |
| `close` | 关闭会话及其终端标签页。 |

## 配置

可在 VSCode 设置中配置 `bashterm-mcp-server.*`。

| 设置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `bashterm-mcp-server.autoConfigureClaudeCode` | boolean | `true` | 自动配置 Claude Code，使其优先使用 BashTerm MCP 而不是内置 `Bash`。 |
| `bashterm-mcp-server.blockedCommands` | string[] | `["rm -rf /", "mkfs", "dd if=", ":(){ :|:& };:"]` | 始终拒绝执行的命令前缀。 |
| `bashterm-mcp-server.allowedDirectories` | string[] | `[]` | 允许的工作目录。为空表示不限制。 |
| `bashterm-mcp-server.defaultTimeoutMs` | number | `30000` | 默认命令超时时间，单位毫秒。 |
| `bashterm-mcp-server.maxConcurrentSessions` | number | `10` | 最大并发终端会话数。 |
| `bashterm-mcp-server.maxOutputLines` | number | `10000` | 每个会话最多缓冲的输出行数。 |
| `bashterm-mcp-server.idleTimeoutMs` | number | `300000` | 空闲会话自动关闭时间，单位毫秒。`0` 表示禁用。 |
| `bashterm-mcp-server.windowsDefaultShell` | string | `"vscode"` | Windows 下未明确指定 shell 时的默认终端。可选值：`vscode`、`cmd`、`powershell`、`pwsh`。 |
| `bashterm-mcp-server.windowsShellDetection` | boolean | `true` | 根据命令特征自动将 Windows 命令路由到 cmd 或 PowerShell（仅对 `run` 工具生效）。 |

## 环境要求

- VSCode 1.99+
- Node.js 20+
- Claude Code 或其它支持 MCP 的客户端

## 适合什么场景

BashTerm MCP 特别适合那些你希望亲眼观察的命令：测试、包安装、开发服务器、数据库迁移、脚手架工具、部署脚本，以及任何可能需要输入或运行时间较长的命令。

## 更新日志

完整历史见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT
