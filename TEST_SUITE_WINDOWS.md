# BashTerm MCP — Windows 平台测试集

此文档供 Claude Code 逐条执行，验证 BashTerm MCP 在 Windows 平台的功能是否正常。

> **使用方式**：将本文档内容逐节发给 Claude Code，让它按编号顺序执行每条测试，观察终端行为和返回结果。

---

## 前置条件

1. VSCode 已安装 BashTerm MCP 扩展
2. Claude Code 已配置 BashTerm MCP server
3. 测试前关闭所有已有终端（`mcp__BashTerm__list` 确认无残留 session）

---

## 第一组：终端生命周期

### 1.1 创建 cmd 终端（默认 shell）

```
mcp__BashTerm__create { name: "test-cmd-default" }
```

**预期**：创建成功，返回 sessionId，VSCode 中出现名为 "test-cmd-default" 的 cmd.exe 终端标签页。

### 1.2 创建 PowerShell 终端

```
mcp__BashTerm__create { name: "test-powershell", shell: "powershell" }
```

**预期**：创建成功，VSCode 中出现名为 "test-powershell" 的 PowerShell 终端标签页。

### 1.3 创建指定 cwd 的终端

```
mcp__BashTerm__create { name: "test-cwd", cwd: "C:\\Windows\\System32" }
```

**预期**：创建成功，终端工作目录为 `C:\Windows\System32`。

### 1.4 创建带环境变量的终端

```
mcp__BashTerm__create { name: "test-env", env: { "MY_TEST_VAR": "hello_from_env" } }
```

**预期**：创建成功。

### 1.5 列出所有终端

```
mcp__BashTerm__list {}
```

**预期**：返回包含上述 4 个 session 的列表，每个包含 sessionId、name、shell、cwd 等字段。

### 1.6 按 agentId 过滤列表

```
mcp__BashTerm__list { agentId: "non-existent-agent" }
```

**预期**：返回空列表（无匹配 session）。

### 1.7 关闭终端

逐个关闭上述 4 个 session：
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

## 第二组：cmd.exe 命令执行

### 2.1 创建 cmd 终端并执行简单命令

```
mcp__BashTerm__create { name: "test-cmd-exec" }
# 记录返回的 sessionId
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo hello world" }
```

**预期**：exec 返回结果包含 "hello world"。

### 2.2 多行命令执行

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo line1 && echo line2 && echo line3" }
```

**预期**：返回结果包含 "line1"、"line2"、"line3" 三行。

### 2.3 中文/Unicode 输出

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo 你好世界！🎉" }
```

**预期**：返回结果包含 "你好世界！🎉"（Unicode 不乱码）。

### 2.4 cmd 专用语法：`%VAR%` 变量

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo %COMSPEC%" }
```

**预期**：返回结果包含 `cmd.exe` 路径。

### 2.5 cmd 专用语法：`set` 命令

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "set MY_TEST=42 && echo %MY_TEST%" }
```

**预期**：返回结果包含 "42"。

### 2.6 cmd 专用语法：`dir` 命令

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "dir /b C:\\Windows\\System32\\notepad.exe" }
```

**预期**：返回结果包含 "notepad.exe"。

### 2.7 cmd 专用语法：`type` 命令

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo test_content > %TEMP%\\bashterm_test_file.txt && type %TEMP%\\bashterm_test_file.txt" }
```

**预期**：返回结果包含 "test_content"。

### 2.8 退出码（成功）

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "exit /b 0" }
```

**预期**：返回 exitCode 为 0。

### 2.9 退出码（失败）

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "exit /b 42" }
```

**预期**：返回 exitCode 为 42 或非零值。

### 2.10 命令超时

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "ping -n 60 127.0.0.1", timeoutMs: 3000 }
```

**预期**：返回超时错误，不会永久卡住。

### 2.11 关闭

```
mcp__BashTerm__close { sessionId: "<sessionId>" }
```

---

## 第三组：PowerShell 命令执行

### 3.1 创建 PowerShell 终端并执行简单命令

```
mcp__BashTerm__create { name: "test-pwsh-exec", shell: "powershell" }
# 记录返回的 sessionId
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "Write-Output 'hello from powershell'" }
```

**预期**：返回结果包含 "hello from powershell"。

### 3.2 PowerShell 变量语法 `$var`

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "$myvar = 'pwsh_value'; Write-Output $myvar" }
```

**预期**：返回结果包含 "pwsh_value"。

### 3.3 PowerShell 环境变量 `$env:`

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "$env:COMPUTERNAME" }
```

**预期**：返回当前计算机名。

### 3.4 PowerShell cmdlet：`Get-ChildItem`

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "Get-ChildItem C:\\Windows\\System32\\notepad.exe | Select-Object Name" }
```

**预期**：返回结果包含 "notepad.exe"。

### 3.5 PowerShell 管道

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "1,2,3,4,5 | Where-Object { $_ -gt 3 } | ForEach-Object { $_ * 10 }" }
```

**预期**：返回结果包含 "40" 和 "50"。

### 3.6 中文/Unicode

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "Write-Output '你好 PowerShell！🚀'" }
```

**预期**：返回结果包含 "你好 PowerShell！🚀"。

### 3.7 退出码

```
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "exit 7" }
```

**预期**：返回 exitCode 为 7。

### 3.8 关闭

```
mcp__BashTerm__close { sessionId: "<sessionId>" }
```

---

## 第四组：`run` 工具自动规划

### 4.1 run 自动创建 cmd（普通命令无 shell 信号）

```
mcp__BashTerm__run { command: "echo auto-detected-cmd" }
```

**预期**：自动创建 cmd 终端，执行成功，返回结果包含 "auto-detected-cmd"。

### 4.2 run 自动检测 PowerShell 语法

```
mcp__BashTerm__run { command: "Get-Date -Format yyyy-MM-dd" }
```

**预期**：自动检测到 PowerShell 语法（`Get-*` cmdlet），创建 PowerShell 终端执行。

### 4.3 run 自动检测 cmd 语法

```
mcp__BashTerm__run { command: "set TEST_VAR=auto_detect && echo %TEST_VAR%" }
```

**预期**：自动检测到 cmd 语法（`set` + `%VAR%`），创建 cmd 终端执行。

### 4.4 run 冲突语法检测

```
mcp__BashTerm__run { command: "Get-ChildItem && echo %COMSPEC%" }
```

**预期**：返回错误，提示同时包含 PowerShell 和 cmd 语法。

### 4.5 run 复用已有 session

先 list 记录 session 数量，再连续两次 run 相同命令：
```
mcp__BashTerm__run { command: "echo first_run" }
mcp__BashTerm__run { command: "echo second_run" }
mcp__BashTerm__list {}
```

**预期**：两次 run 复用同一个 session（session 数量为 1）。

### 4.6 run 指定 name

```
mcp__BashTerm__run { command: "echo named-session", name: "my-custom-name" }
```

**预期**：终端标签页显示 "my-custom-name"。

### 4.7 run 指定 cwd

```
mcp__BashTerm__run { command: "cd", cwd: "C:\\Windows\\System32" }
```

**预期**：输出显示当前目录为 `C:\Windows\System32`。

### 4.8 run 指定 env

```
mcp__BashTerm__run { command: "echo %RUN_TEST_VAR%", env: { "RUN_TEST_VAR": "run_env_value" } }
```

**预期**：返回结果包含 "run_env_value"。

### 4.9 run 指定 shell 覆盖自动检测

```
mcp__BashTerm__run { command: "Get-Date", shell: "powershell" }
```

**预期**：使用 PowerShell 执行 `Get-Date`。

### 4.10 清理

```
# 关闭所有残留 session
```

---

## 第五组：输出读取

### 5.1 创建终端并执行多条命令

```
mcp__BashTerm__create { name: "test-read" }
# 记录 sessionId
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo line_a" }
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo line_b" }
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "echo line_c" }
```

### 5.2 增量读取（默认 offset=0）

```
mcp__BashTerm__read { sessionId: "<sessionId>" }
```

**预期**：返回未读过的输出（增量）。

### 5.3 Tail 读取（负 offset）

```
mcp__BashTerm__read { sessionId: "<sessionId>", offset: -5 }
```

**预期**：返回最后 5 行以内。

### 5.4 限制行数

```
mcp__BashTerm__read { sessionId: "<sessionId>", lines: 2 }
```

**预期**：返回不超过 2 行。

### 5.5 关闭

```
mcp__BashTerm__close { sessionId: "<sessionId>" }
```

---

## 第六组：交互式输入

### 6.1 创建终端并启动交互程序（cmd）

```
mcp__BashTerm__create { name: "test-interactive" }
# 记录 sessionId
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "set /p NAME=Enter your name: ", timeoutMs: 5000, waitForCompletion: false }
```

### 6.2 发送输入

```
mcp__BashTerm__input { sessionId: "<sessionId>", input: "Claude" }
```

### 6.3 读取确认

```
mcp__BashTerm__read { sessionId: "<sessionId>" }
```

**预期**：输出中包含 "Claude" 相关反馈。

### 6.4 不带 Enter 的输入

```
mcp__BashTerm__input { sessionId: "<sessionId>", input: "partial", pressEnter: false }
```

**预期**：输入发送但未提交，终端显示 "partial" 在输入行但未执行。

### 6.5 关闭

```
mcp__BashTerm__close { sessionId: "<sessionId>" }
```

---

## 第七组：Shell 兼容性检查

### 7.1 cmd 语法命令不能在 PowerShell session 执行

```
mcp__BashTerm__create { name: "test-shell-check", shell: "powershell" }
# 记录 sessionId
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "dir /b C:\\Windows\\System32\\notepad.exe" }
```

**预期**：返回错误，提示 `dir /b` 不适合 PowerShell（应使用 `Get-ChildItem`），命令被拒绝。

### 7.2 PowerShell 语法可能在 cmd session 执行（取决于 planner）

```
mcp__BashTerm__create { name: "test-cmd-check", shell: "cmd" }
# 记录 sessionId
mcp__BashTerm__exec { sessionId: "<sessionId>", command: "Get-Date" }
```

**预期**：可能被拒绝（PowerShell 语法不兼容 cmd session），或由 planner 检测后提示。

### 7.3 清理

```
mcp__BashTerm__close { sessionId: "<sessionId>" }  # 对两个 session 分别执行
```

---

## 第八组：路径与特殊字符

### 8.1 带空格的路径

```
mcp__BashTerm__run { command: "echo hello", cwd: "C:\\Program Files" }
```

**预期**：正确在 `C:\Program Files` 下执行。

### 8.2 命令中包含引号

```
mcp__BashTerm__run { command: "echo \"quoted string with spaces\"" }
```

**预期**：返回 "quoted string with spaces"。

### 8.3 命令中包含百分号（cmd 批处理变量）

```
mcp__BashTerm__run { command: "echo %%TEMP%%" }
```

**预期**：返回 `%TEMP%` 字面值（转义后的百分号），而非展开环境变量。

### 8.4 PowerShell 花括号和脚本块

```
mcp__BashTerm__run { command: "& { Write-Output 'script block works' }" }
```

**预期**：返回 "script block works"。

---

## 第九组：waitForCompletion 模式

### 9.1 等待完成（默认）

```
mcp__BashTerm__run { command: "echo wait_test", waitForCompletion: true }
```

**预期**：等待命令完成后返回完整输出。

### 9.2 不等待完成（fire-and-forget）

```
mcp__BashTerm__run { command: "echo fire_and_forget_test", waitForCompletion: false }
```

**预期**：立即返回（命令可能还在运行），随后可以通过 read 读取输出。

### 9.3 读取 fire-and-forget 结果

等待 2 秒后：
```
mcp__BashTerm__read { sessionId: "<上一命令的sessionId>" }
```

**预期**：能读取到 "fire_and_forget_test" 输出。

---

## 第十组：并发与隔离

### 10.1 两个独立终端分别执行

```
mcp__BashTerm__create { name: "terminal-A" }  # 记录 sessionId-A
mcp__BashTerm__create { name: "terminal-B" }  # 记录 sessionId-B
mcp__BashTerm__exec { sessionId: "<sessionId-A>", command: "echo from_A" }
mcp__BashTerm__exec { sessionId: "<sessionId-B>", command: "echo from_B" }
```

**预期**：两个 session 的输出互不干扰。

### 10.2 关闭所有

```
mcp__BashTerm__close { sessionId: "<sessionId-A>" }
mcp__BashTerm__close { sessionId: "<sessionId-B>" }
```

---

## 第十一组：错误处理

### 11.1 执行不存在的命令（cmd）

```
mcp__BashTerm__run { command: "this_command_does_not_exist_12345" }
```

**预期**：返回错误信息（命令未找到），exitCode 非零。

### 11.2 执行不存在的命令（PowerShell）

```
mcp__BashTerm__run { command: "Invoke-NonExistentCmdlet-XYZ" }
```

**预期**：返回错误信息，exitCode 非零。

### 11.3 空命令（run）

```
mcp__BashTerm__run { command: "" }
```

**预期**：返回验证错误。

### 11.4 仅空白命令

```
mcp__BashTerm__run { command: "   " }
```

**预期**：返回验证错误。

---

## 第十二组：端到端场景

### 12.1 典型 Claude Code 工作流

```
# 1. 创建项目目录
mcp__BashTerm__run { command: "mkdir C:\\temp\\bashterm-e2e-test 2>nul & echo ready" }

# 2. 写入文件
mcp__BashTerm__run { command: "echo // e2e test file > C:\\temp\\bashterm-e2e-test\\app.js" }

# 3. 列出文件
mcp__BashTerm__run { command: "dir C:\\temp\\bashterm-e2e-test" }

# 4. 读取文件内容
mcp__BashTerm__run { command: "type C:\\temp\\bashterm-e2e-test\\app.js" }

# 5. 清理
mcp__BashTerm__run { command: "rmdir /s /q C:\\temp\\bashterm-e2e-test" }
```

**预期**：每步成功执行。

### 12.2 PowerShell 端到端

```
mcp__BashTerm__run { command: "New-Item -Path C:\\temp\\pwsh-e2e -ItemType Directory -Force; 'created' | Set-Content C:\\temp\\pwsh-e2e\\info.txt; Get-Content C:\\temp\\pwsh-e2e\\info.txt; Remove-Item C:\\temp\\pwsh-e2e -Recurse -Force" }
```

**预期**：创建目录 -> 写入文件 -> 读取文件 -> 清理，全部成功。

---

## 检查清单

测试完成后逐项打勾：

- [ ] 1.x 终端生命周期（创建/列表/关闭）
- [ ] 2.x cmd.exe 执行（简单命令/多行/Unicode/cmd 语法/退出码/超时）
- [ ] 3.x PowerShell 执行（cmdlet/管道/变量/Unicode/退出码）
- [ ] 4.x run 自动规划（Shell 检测/复用/命名/cwd/env/冲突检测）
- [ ] 5.x 输出读取（增量/tail/限制行数）
- [ ] 6.x 交互式输入（send input / pressEnter）
- [ ] 7.x Shell 兼容性检查（拒绝不兼容语法）
- [ ] 8.x 路径与特殊字符（空格/引号/百分号/脚本块）
- [ ] 9.x waitForCompletion（等待/不等待）
- [ ] 10.x 并发与隔离（多终端独立运行）
- [ ] 11.x 错误处理（不存在命令/空命令）
- [ ] 12.x 端到端场景（完整工作流）

---

## 注意事项

1. **执行顺序**：按组顺序执行，同一组内按编号执行。前一组全部通过后再进入下一组。
2. **手动观察**：除检查返回结果外，还应观察 VSCode 终端标签页的标题、Shell 类型是否正确。
3. **清理**：每组测试结束后清理 session，避免残留终端影响后续测试。
4. **速度**：cmd 脚本执行器有 temp 文件写入开销，单次 exec 可能需要 1-3 秒。
5. **Unicode**：部分 Windows 系统默认代码页为 GBK（936），如果 Unicode 测试失败，可能是系统区域设置问题，非代码 bug。
