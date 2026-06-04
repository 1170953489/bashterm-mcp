# Changelog

All notable changes to this project will be documented in this file.

## [0.2.3] - 2026-06-04

### Fixed
- 修复 Windows 下可见终端 shell 不一致问题：创建终端时显式传入 shellPath，统一 shell 解析逻辑

### Changed
- CLAUDE.md 新增发布流程规则（URL 字段检查、VSIX 资产验证、tag 推送等）
- CLAUDE.md 新增 Commit Message Style 规则，规范提交说明格式
- CLAUDE.md 新增版本号递增规则（semver）
- CLAUDE.md 删除无实际作用的项目标题和简介
- 修复 package.json 和 server.json 仓库地址及 homepage 字段错误

## [0.2.2] - 2026-06-04

### Added
- 扩展激活时自动配置 Claude Code hook，禁止内置 Bash 工具，引导使用 BashTerm MCP 工具
- `restoreClaudeCodeDefaultBash` 命令，允许用户一键恢复 Claude Code 默认 Bash 工具

### Fixed
- 修复 `shell` 参数无效导致终端使用默认 shell 而非指定 shell 的问题
- 修复 Windows 中文输出乱码问题
- 修复 Claude Code hook 自动配置 JSON 格式错误

### Changed
- `autoConfigureClaudeCode` 改为写入用户目录 `~/.claude/settings.json` 而非项目级别配置
- README 安装指南简化为仅安装 VSCode 扩展即可，零手动配置
- README 完善 Claude Code Bash 回归与恢复说明

## [0.2.1] - 2026-06-04

### Changed
- 全面重命名为 BashTerm MCP：统一所有文档和代码中的项目名称引用
- 修复 v0.2.0 标签指向错误的 commit

## [0.2.0] - 2026-06-04

### Added
- 命令白名单支持（`bashterm-mcp.allowedCommands` 配置）
- 终端就绪检测 `whenReady()`：基于 Shell Integration 信号 + 2s fallback
- 会话复用时匹配 `env` 和 `shell` 配置，避免环境冲突
- `cleanOutput()` / `stripCommandEcho()` ANSI 清洗工具函数，使用 `strip-ansi` 库

### Fixed
- 环形缓冲区 `lastReadIndex` 多次溢出后变为负数导致读取死循环
- Shell Integration 与 `child_process.exec()` 同时写入缓冲区导致输出重复
- JSON-RPC 通知被分配 ID 后泄漏在 `pendingRequests` 中
- `validateCommand()` 不支持白名单模式（现已通过 `CommandGuard` 支持）

### Changed
- **启用空闲会话回收器**：默认 5 分钟无活动自动关闭（可通过 `idleTimeoutMs: 0` 禁用）
- **启用 `CommandGuard`**：统一命令验证逻辑，替代 `SessionManager` 内联方法
- **批量 splice 替代逐行 `shift()`**：缓冲区写入性能 O(n×m) → O(n+m)
- **版本号动态读取**：`serverInfo.version` 不再硬编码，从 `package.json` 获取
- **启动时不再弹出输出面板**：OutputChannel 保持在后台
- **提取共享格式化逻辑**：`exec` 和 `run` 的 ANSI 清洗/状态行合并为 `formatExecuteResult()`
- 升级 `server.json` 版本号与 `package.json` 对齐

## [0.1.8] - 2026-06-03

### Changed
- 仓库/包名从 vscode-terminal-mcp 改为 bashterm-mcp，同步更新所有引用
- VSIX 徽章改为动态版本号
- 图标改为动态版本

### Fixed
- 修复 npm 二进制入口路径（`bin` 字段）

## [0.1.7] - 2026-05-29

### Added
- Windows 平台完整支持：IPC 改用 Windows named pipe
- 命令执行改用 `child_process.exec()` 直接捕获输出，兼容所有平台
- Windows 下自动检测并解码 GBK 中文输出

### Fixed
- 修复 Windows 上 Unix socket `EACCES` 权限错误
- 修复 Shell Integration API 在不支持的终端环境下不触发的问题
- 修复 Windows 中文输出乱码

## [0.1.6] - 2026-03-19 18:18 PDT

### Added
- Screenshots in README for marketplace (run, exec, permission dialog)
- Custom terminal tab names with date format (e.g., `MCP: BashTerm-26-03-19-17-30`)
- `name` parameter in `run` tool for custom terminal names
- Unique IPC socket per workspace to prevent conflicts between multiple VSCode instances
- Large output handling documentation
- Development workflow docs for extension cache workaround

### Fixed
- Clean output format for all tools (`run`, `exec`, `read`, `list`, `close`, `input`) — no more raw JSON responses
- `waitForCompletion: false` not working (`z.coerce.boolean()` converted string `"false"` to `true`)
- Idle reaper killing sessions with running commands — reaper disabled, user closes sessions manually

## [0.1.5] - 2026-03-18 14:50 PDT

### Added
- npm publish with `bin` entry for `npx bashterm-mcp` support
- Published to VSCode Marketplace and MCP Registry

## [0.1.3] - 2026-03-18 11:00 PDT

### Added
- `run` tool combining create + exec in one step
- Session reuse: `run` finds idle sessions before creating new ones
- Busy session detection: won't reuse sessions with running commands

### Fixed
- First-command timing fix with shell initialization delay

## [0.1.0] - 2026-03-18 10:00 PDT

### Added
- Initial release
- Tools: `create`, `exec`, `read`, `input`, `list`, `close`
- Shell Integration API for output capture and exit code detection
- Circular output buffer with pagination support
- Subagent isolation with `agentId`
- Command blocklist security
- IPC bridge for MCP stdio-to-socket communication
