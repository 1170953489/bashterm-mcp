# Project: BashTerm MCP

MCP server that runs commands in visible VSCode terminal tabs.

---

## Release Process

以下以发布 v0.2.1 为例，一步一步执行。

> 📋 **规则编写原则**：只描述当前正确的操作步骤和禁止事项，不写「历史上有一次…」「之前搞错过…」等回顾性描述。规则是给人照着做的，不是用来复盘过去的。

### 1. 更新版本号（2 个文件，3 处）

```bash
# package.json "version": "0.2.0" → "0.2.1"
# server.json 顶层 "version": "0.2.0" → "0.2.1"
# server.json packages[0].version: "0.2.0" → "0.2.1"
```

> ⚠️ **版本号改完后，必须检查以下 URL 字段是否正确：**
>
> **package.json：**
> - `repository.url` → 必须是 `git+https://github.com/1170953489/bashterm-mcp.git`
>   - ❌ `bashterm-mcp-server.git`（多了 `-server`，npm README 中文链接会 404）
> - `homepage` → 必须是 `https://github.com/1170953489/bashterm-mcp#readme`
> - `bugs.url` → 必须是 `https://github.com/1170953489/bashterm-mcp/issues`
>
> **server.json：**
> - `homepage` → 必须是 `https://github.com/1170953489/bashterm-mcp`
>   - ❌ `github.com/hcdb/bashterm-mcp`（`hcdb` 是 VSCode publisher，不是 GitHub 用户名）
> - `repository.url` → 必须是 `https://github.com/1170953489/bashterm-mcp`
>
> 用以下命令快速检查：
> ```bash
> grep -n "1170953489" package.json server.json
> grep -n "bashterm-mcp-server\.git\|github\.com/hcdb/" package.json server.json  # 不应有输出
> ```

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

### 7. 创建 GitHub Release 并上传 VSIX

```bash
gh release create v0.2.1 \
  --title "v0.2.1 — BashTerm MCP" \
  --notes "从 CHANGELOG.md 完整复制该版本的 Added / Fixed / Changed 内容，禁止只写占位文字" \
  bashterm-mcp-server-0.2.1.vsix
```

> ⚠️ **必须验证 VSIX 资产上传成功：**
> ```bash
> gh release view v0.2.1 --json assets  # 确认 assets 数组非空，包含 .vsix 文件
> ```
> 如果 assets 为空，手动补传：
> ```bash
> gh release upload v0.2.1 bashterm-mcp-server-0.2.1.vsix
> ```

### 8. 上传 VSCode Marketplace

1. 打开 https://marketplace.visualstudio.com/manage/publishers/hcdb
2. 找到 BashTerm MCP → `...` → **Update**
3. 上传 `.vsix`

> 备选：配置 Azure DevOps PAT 后可用 `npx vsce publish` 一键发布。

### 9. 打标签、提交和推送

```bash
# 1. 提交所有变更
git add -A
git commit -m "v0.2.1：<变更摘要>"

# 2. 在对应的 release commit 上打 tag
git tag v0.2.1

# 3. 推送 commit 和 tag（两步缺一不可）
git push
git push origin v0.2.1

# 4. 验证远程 tag 存在
git ls-remote --tags origin | grep v0.2.1
```

> ⚠️ **`git push` 只推分支，不推 tag。** 忘记 `git push origin v0.2.1` 会导致 GitHub Release 找不到对应的 tag。
> 如果 `gh release create` 在 Step 7 已自动创建了 tag，这一步的 `git tag` 和 `git push origin` 可跳过，但必须用 `git ls-remote` 确认远程 tag 存在。

---

## 扩展缓存绕过

VSCode 会积极缓存扩展文件。本地开发时：

```bash
# 修改源码后快速更新
npm run build
cp dist/extension.js ~/.vscode/extensions/hcdb.bashterm-mcp-server-<版本号>/dist/extension.js
# 然后执行 "Developer: Reload Window"

# 如果 Reload 没生效，完全关闭再重新打开 VSCode
```
