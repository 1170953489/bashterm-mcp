# Project: BashTerm MCP

MCP server that runs commands in visible VSCode terminal tabs.

## Terminal Execution

Prefer the BashTerm MCP tools (`run`, `exec`, `read`, etc.) over the built-in Bash tool for executing commands. BashTerm runs commands in visible VSCode terminal tabs where the user can see output in real time.

For commands that may take longer than 30 seconds or produce large output, use pull mode:
1. Call `run` with `waitForCompletion: false`
2. Call `read` with `offset: -10` to check progress
3. Repeat until done

---

## Release Process

以下以发布 v0.2.1 为例，一步一步执行。

### 1. 更新版本号（2 个文件，3 处）

```bash
# package.json "version": "0.2.0" → "0.2.1"
# server.json 顶层 "version": "0.2.0" → "0.2.1"
# server.json packages[0].version: "0.2.0" → "0.2.1"
```

### 2. 更新 CHANGELOG.md

在文件顶部新增条目：

```markdown
## [0.2.1] - YYYY-MM-DD

### Added
- 新功能...

### Fixed
- 修复...

### Changed
- 变更...
```

### 3. 更新 README.md 和 README.zh-CN.md

替换 **Latest Changes** 节为新版本改动，只列核心条目，完整历史指向 CHANGELOG.md。

> ⚠️ **不要用 `replace_all` 做模糊全局替换！** `bashterm-` 会匹配并误伤 `bashterm-mcp` 等 URL。只精确替换目标字符串。

### 4. 构建和测试

```bash
npm run build      # esbuild 双产物：dist/extension.js + dist/mcp-entry.js
npm test           # 45 tests must pass
```

### 5. 打包 VSIX

```bash
npx vsce package --allow-missing-repository
# 生成 bashterm-mcp-server-0.2.1.vsix
```

### 6. 发布 npm

```bash
npm whoami                  # 确认已登录
npm publish --access public
```

### 7. 创建 GitHub Release

```bash
gh release create v0.2.1 \
  --title "v0.2.1 — BashTerm MCP" \
  --notes "从 CHANGELOG.md 复制改动内容" \
  bashterm-mcp-server-0.2.1.vsix
```

### 8. 上传 VSCode Marketplace

1. 打开 https://marketplace.visualstudio.com/manage/publishers/hcdb
2. 找到 BashTerm MCP → `...` → **Update**
3. 上传 `.vsix`

> 备选：配置 Azure DevOps PAT 后可用 `npx vsce publish` 一键发布。

### 9. 提交和推送

```bash
git add -A
git commit -m "v0.2.1：<变更摘要>"
git push
```

### 10. 验证

- [ ] `npx bashterm-mcp-server@latest` 正常启动
- [ ] VSCode 扩展商店搜索 "BashTerm MCP" 显示新版本
- [ ] https://www.npmjs.com/package/bashterm-mcp-server 显示新版本
- [ ] GitHub Release 徽章显示新版本号
- [ ] README.md 和 README.zh-CN.md 的徽章链接全部正常

---

## Extension Cache Workaround

VSCode aggressively caches extensions. When developing locally:

```bash
# Quick update (after modifying source)
npm run build
cp dist/extension.js ~/.vscode/extensions/hcdb.bashterm-mcp-server-<version>/dist/extension.js
# Then "Developer: Reload Window"

# If reload doesn't pick up changes, close and reopen VSCode completely
```
