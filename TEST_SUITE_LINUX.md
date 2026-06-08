# BashTerm MCP — Linux 平台测试集

此文档供 Claude Code 逐条执行，验证 BashTerm MCP 在 Linux 平台的功能是否正常。

> **使用方式**：将本文档内容逐节发给 Claude Code，让它按编号顺序执行每条测试，观察终端行为和返回结果。
>
> Linux 上没有 cmd/powershell 的 shell 规划逻辑，所有命令直接通过 VSCode shell integration 执行，天然满足"Visible by default"。

---

## 前置条件

1. VSCode 已安装 BashTerm MCP 扩展
2. Claude Code 已配置 BashTerm MCP server
3. 测试前关闭所有已有终端（`mcp__BashTerm__list` 确认无残留 session）

---

## 第一组：终端生命周期

### 1.1 创建默认 shell 终端

```
mcp__BashTerm__create { name: "test-bash-default" }
```

**预期**：创建成功，返回 sessionId，VSCode 中出现名为 "test-bash-default" 的终端标签页（默认 bash）。

### 1.2 创建指定 shell 终端（zsh）

```
mcp__BashTerm__create { name: "test-zsh", shell: "/bin/zsh" }
```

**预期**：创建成功，标签页显示 "test-zsh"。如果没有 zsh 则跳过。

### 1.3 创建指定 cwd 的终端

```
mcp__BashTerm__create { name: "test-cwd", cwd: "/tmp" }
```

**预期**：创建成功，终端工作目录为 `/tmp`。

### 1.4 创建带环境变量的终端

```
mcp__BashTerm__create { name: "test-env", env: { "MY_TEST_VAR": "hello_from_env" } }
```

**预期**：创建成功。

### 1.5 列出所有终端

```
mcp__BashTerm__list {}
```

**预期**：返回包含上述 session 的列表，每个包含 sessionId、name、shell、cwd 等字段。

### 1.6 按 agentId 过滤列表

```
mcp__BashTerm__list { agentId: "non-existent-agent" }
```

**预期**：返回空列表（无匹配 session）。

### 1.7 关闭终端

逐个关闭上述 session：
```
mcp__BashTerm__close { sessionId: "<sessionId>" }
```

**预期**：每个关闭成功，VSCode 中对应标签页消失。

### 1.8 关闭不存在的终端

```
mcp__BashTerm__close { sessionId: "non-existent-id" }
```

**预期**：返回错误，提示 session 不存在。

### 1.9 列出确认清空

```
mcp__BashTerm__list {}
```

**预期**：返回空列表。

---

## 第二组：bash 命令执行

### 2.1 创建终端并执行简单命令

```
mcp__BashTerm__create { name: "test-bash-exec" }
# 记录返回的 sessionId
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo hello world" }
```

**预期**：exec 返回结果包含 "hello world"。

### 2.2 多行命令（`&&` 链式）

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo line1 && echo line2 && echo line3" }
```

**预期**：返回结果包含 "line1"、"line2"、"line3"。

### 2.3 中文/Unicode 输出

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo 你好世界！🎉" }
```

**预期**：返回结果包含 "你好世界！🎉"（Unicode 不乱码）。

### 2.4 Shell 变量 `$VAR`

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "MY_VAR=shell_value && echo $MY_VAR" }
```

**预期**：返回结果包含 "shell_value"。

### 2.5 环境变量

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo $SHELL" }
```

**预期**：返回当前 shell 路径（如 `/bin/bash`）。

### 2.6 管道（pipe）

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo apple banana cherry | tr ' ' '\n' | grep a" }
```

**预期**：返回包含 "a" 的行（"apple"、"banana"）。

### 2.7 文件操作

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo test_content > /tmp/bashterm_test_file.txt && cat /tmp/bashterm_test_file.txt && rm /tmp/bashterm_test_file.txt" }
```

**预期**：返回结果包含 "test_content"，文件被清理。

### 2.8 退出码（成功）

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "true" }
```

**预期**：返回 exitCode 为 0。

### 2.9 退出码（失败）

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "bash -c 'exit 42'" }
```

**预期**：返回 exitCode 为 42。
> 注意：不能用 `exit` 命令，因为它会终止当前 shell 进程并关闭终端。

### 2.10 命令超时

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "sleep 60", timeoutMs: 3000 }
```

**预期**：返回超时错误（~3 秒），不会永久卡住。

### 2.11 后台命令（fire-and-forget 暂不可捕获）

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "sleep 5 & echo backgrounded" }
```

**预期**：返回结果包含 "backgrounded"，sleep 在后台执行。

### 2.12 关闭

```
mcp__BashTerm__close { sessionId: "<sessionId>" }
```

---

## 第三组：`run` 工具行为

### 3.1 run 自动创建终端

```
mcp__BashTerm__run { command: "echo auto-created-terminal" }
```

**预期**：自动创建终端（默认 bash），返回结果包含 "auto-created-terminal"。

### 3.2 run 复用已有 session

先 list 记录数量，再连续两次 run：
```
mcp__BashTerm__run { command: "echo first" }
mcp__BashTerm__run { command: "echo second" }
mcp__BashTerm__list {}
```

**预期**：两次 run 复用同一个 session。

### 3.3 run 指定 name

```
mcp__BashTerm__run { command: "echo named-session", name: "my-linux-session" }
```

**预期**：终端标签页显示 "my-linux-session"（name 匹配时复用，不匹配时新建）。

### 3.4 run 指定 cwd

```
mcp__BashTerm__run { command: "pwd", cwd: "/tmp" }
```

**预期**：输出显示 `/tmp`。

### 3.5 run 指定 env

```
mcp__BashTerm__run { command: "echo $RUN_ENV_VAR", env: { "RUN_ENV_VAR": "env_value" } }
```

**预期**：返回结果包含 "env_value"。

### 3.6 run 指定 shell

```
mcp__BashTerm__run { command: "echo $0", shell: "/bin/bash" }
```

**预期**：输出显示 "bash" 或 `/bin/bash`。

### 3.7 run fire-and-forget

```
mcp__BashTerm__run { command: "sleep 10 && echo done", waitForCompletion: false }
```

**预期**：立即返回，终端中有 sleep 在运行。

### 3.8 清理

关闭所有残留 session。

---

## 第四组：输出读取

### 4.1 创建终端并执行多条命令

```
mcp__BashTerm__create { name: "test-read" }
# 记录 sessionId
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo line_a" }
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo line_b" }
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo line_c" }
```

### 4.2 增量读取（默认 offset=0）

```
mcp__BashTerm__read { sessionId: "<sessionId>" }
```

**预期**：返回未读过的输出行。

### 4.3 Tail 读取（负 offset）

```
mcp__BashTerm__read { sessionId: "<sessionId>", offset: -3 }
```

**预期**：返回最后 3 行以内。

### 4.4 限制行数

```
mcp__BashTerm__read { sessionId: "<sessionId>", lines: 2 }
```

**预期**：返回不超过 2 行。

### 4.5 关闭

```
mcp__BashTerm__close { sessionId: "<sessionId>" }
```

---

## 第五组：交互式输入

### 5.1 创建终端并启动交互程序

```
mcp__BashTerm__create { name: "test-interactive" }
# 记录 sessionId
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "read -p 'Name: ' NAME; echo Got: $NAME", timeoutMs: 5000, waitForCompletion: false }
```

### 5.2 发送输入

```
mcp__BashTerm__input { sessionId: "<sessionId>", input: "Claude" }
```

### 5.3 读取确认

```
mcp__BashTerm__read { sessionId: "<sessionId>" }
```

**预期**：输出中包含 "Got: Claude"。

### 5.4 不带 Enter 的输入

```
mcp__BashTerm__input { sessionId: "<sessionId>", input: "partial", pressEnter: false }
```

**预期**：输入发送但未提交。

### 5.5 关闭

```
mcp__BashTerm__close { sessionId: "<sessionId>" }
```

---

## 第六组：路径与特殊字符

### 6.1 带空格的路径 cwd

```
mcp__BashTerm__run { command: "echo hello", cwd: "/tmp/test with spaces" }
```

**预期**：如果目录不存在，可能创建失败或返回错误；或需先 `mkdir -p "/tmp/test with spaces"`。

### 6.2 命令中包含引号

```
mcp__BashTerm__run { command: "echo \"quoted string\"" }
```

**预期**：返回 "quoted string"。

### 6.3 命令中包含单引号

```
mcp__BashTerm__run { command: "echo 'single quoted string'" }
```

**预期**：返回 "single quoted string"。

### 6.4 命令中包含美元符号

```
mcp__BashTerm__run { command: "echo '$\{HOME\}'" }
```

**预期**：返回字面值 `${HOME}`，不展开。实际可能需要转义，根据 Claude Code 的 JSON 传参方式调整。

### 6.5 Shell 通配符（glob）

```
mcp__BashTerm__run { command: "ls /bin/bas*" }
```

**预期**：返回 bash 相关路径。

### 6.6 命令替换

```
mcp__BashTerm__run { command: "echo today is $(date +%Y-%m-%d)" }
```

**预期**：返回 "today is YYYY-MM-DD"。

---

## 第七组：并发与隔离

### 7.1 两个独立终端分别执行

```
mcp__BashTerm__create { name: "terminal-A" }  # 记录 sessionId-A
mcp__BashTerm__create { name: "terminal-B" }  # 记录 sessionId-B
mcp__BashTerm__exec { sessionId: "<sessionId-A>", command: "echo from_A" }
mcp__BashTerm__exec { sessionId: "<sessionId-B>", command: "echo from_B" }
```

**预期**：两个 session 的输出互不干扰。

### 7.2 关闭所有

```
mcp__BashTerm__close { sessionId: "<sessionId-A>" }
mcp__BashTerm__close { sessionId: "<sessionId-B>" }
```

---

## 第八组：错误处理

### 8.1 执行不存在的命令

```
mcp__BashTerm__run { command: "this_command_does_not_exist_12345" }
```

**预期**：返回错误信息（command not found），exitCode 非零（127）。

### 8.2 执行返回非零的命令

```
mcp__BashTerm__run { command: "ls /nonexistent/path/xyz" }
```

**预期**：返回错误（No such file or directory），exitCode 非零（2）。

### 8.3 空命令（run）

```
mcp__BashTerm__run { command: "" }
```

**预期**：返回验证错误。

### 8.4 仅空白命令

```
mcp__BashTerm__run { command: "   " }
```

**预期**：返回 "Command blocked: Empty command"。

---

## 第九组：端到端场景

### 9.1 典型工作流

```
# 1. 创建临时目录
mcp__BashTerm__run { command: "mkdir -p /tmp/bashterm-e2e && echo ready" }

# 2. 写入文件
mcp__BashTerm__run { command: "echo '// e2e test on Linux' > /tmp/bashterm-e2e/app.js" }

# 3. 列出文件
mcp__BashTerm__run { command: "ls -la /tmp/bashterm-e2e" }

# 4. 读取文件
mcp__BashTerm__run { command: "cat /tmp/bashterm-e2e/app.js" }

# 5. 构建和测试（模拟 Node.js 项目）
mcp__BashTerm__run { command: "cd /tmp/bashterm-e2e && node -e \"console.log('hello from node')\"" }

# 6. 清理
mcp__BashTerm__run { command: "rm -rf /tmp/bashterm-e2e && echo cleaned" }
```

**预期**：每步成功执行。

### 9.2 多行脚本执行

```
mcp__BashTerm__run { command: "for i in 1 2 3; do
echo number $i
done" }
```

**预期**：返回 "number 1"、"number 2"、"number 3"。

---

## 检查清单

测试完成后逐项打勾：

- [ ] 1.x 终端生命周期（创建/列表/关闭）
- [ ] 2.x bash 执行（简单命令/多行/Unicode/变量/管道/文件/退出码/超时）
- [ ] 3.x run 工具行为（自动创建/复用/命名/cwd/env/shell/fire-forget）
- [ ] 4.x 输出读取（增量/tail/限制行数）
- [ ] 5.x 交互式输入（read 交互/分步输入）
- [ ] 6.x 路径与特殊字符（空格/引号/glob/命令替换）
- [ ] 7.x 并发与隔离（多终端独立运行）
- [ ] 8.x 错误处理（不存在命令/空命令）
- [ ] 9.x 端到端场景（完整工作流 / 多行脚本）

---

## 注意事项

1. **执行顺序**：按组顺序执行，同一组内按编号执行。前一组全部通过后再进入下一组。
2. **手动观察**：除检查返回结果外，还应观察 VSCode 终端标签页的标题、Shell 类型是否正确。
3. **清理**：每组测试结束后清理 session，避免残留终端影响后续测试。
4. **Linux 差异**：Linux 没有 cmd/powershell 规划逻辑，所有命令通过 VSCode shell integration 执行。`run` 工具在非 Windows 平台直接使用系统默认 shell，不做语法分析。
5. **Unicode**：Linux 终端默认为 UTF-8，通常不会出现编码问题。
6. **Shell 兼容性**：bash 语法兼容性远好于 cmd，不存在类似 `%VAR%` vs `$env:` 的冲突。
