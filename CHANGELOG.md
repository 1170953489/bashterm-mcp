# Changelog

All notable changes to this project will be documented in this file.

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
