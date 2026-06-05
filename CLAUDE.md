## Release Process

以下以发布 v0.2.1 为例，一步一步执行。

> 📋 **规则编写原则**：只描述当前正确的操作步骤和禁止事项，不写「历史上有一次…」「之前搞错过…」等回顾性描述。规则是给人照着做的，不是用来复盘过去的。

### 1. 确定并更新版本号（2 个文件，3 处）

**版本号递增规则**（遵循 semver，当前为 0.x 阶段）：

| 场景 | 递增位 | 示例 |
|---|---|---|
| 纯 bug 修复、文档修正、小改进 | Patch（第三位） | 0.2.2 → 0.2.3 |
| 新功能、重要变更、非兼容改动 | Minor（第二位） | 0.2.2 → 0.3.0 |
| 第一个稳定版 | Major（第一位） | 0.2.2 → 1.0.0 |

```bash
# package.json "version" → 新版本号
# server.json 顶层 "version" → 新版本号
# server.json packages[0].version → 新版本号
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

### 7. 提交和推送

`gh release create` 会基于当前 HEAD 创建 tag，因此必须**先提交再发 Release**，否则 tag 指向旧 commit。

**写摘要之前，必须先用以下命令回顾本版本所有改动：**

```bash
git log <上一个版本tag>..HEAD --oneline   # 例如 git log v0.2.1..HEAD --oneline
```

> ⚠️ **CHANGELOG 和 release commit 摘要必须覆盖 `git log` 列出的每一个非发布提交。** 不能只看最近一两个提交，漏掉中间的改动。

```bash
# 1. 提交所有变更
git add -A
git commit -m "v0.2.1：<变更摘要，涵盖上一版本至今所有非发布提交>"

# 2. 推送 commit
git push
```

### 8. 创建 GitHub Release 并上传 VSIX

用 PowerShell 执行（避免 cmd 将 `>` 误解析为重定向）：

```powershell
# 方式一：notes 较短时直接内联（反引号续行）
gh release create v0.2.1 `
  --title "v0.2.1 — BashTerm MCP" `
  --notes "从 CHANGELOG.md 完整复制该版本的 Added / Fixed / Changed 内容，禁止只写占位文字" `
  bashterm-mcp-server-0.2.1.vsix

# 方式二：notes 较长或含特殊字符时，先用文件写入再 --notes-file
gh release create v0.2.1 `
  --title "v0.2.1 — BashTerm MCP" `
  --notes-file $env:TEMP\release_notes.txt `
  bashterm-mcp-server-0.2.1.vsix
```

> `gh release create` 会自动创建 tag 并推送到远程，不需要手动 `git tag` / `git push origin v0.2.1`。
>
> ⚠️ **必须验证 VSIX 资产上传成功：**
> ```powershell
> gh release view v0.2.1 --json assets  # 确认 assets 数组非空，包含 .vsix 文件
> ```
> 如果 assets 为空，手动补传：
> ```powershell
> gh release upload v0.2.1 bashterm-mcp-server-0.2.1.vsix
> ```
> 如果 notes 被截断或不正确，用文件方式修复：
> ```powershell
> gh release edit v0.2.1 --notes-file $env:TEMP\release_notes.txt
> ```
>
> ⚠️ **必须验证远程 tag 存在：**
> ```powershell
> git ls-remote --tags origin | Select-String v0.2.1
> ```

### 9. 上传 VSCode Marketplace

1. 打开 https://marketplace.visualstudio.com/manage/publishers/hcdb
2. 找到 BashTerm MCP → `...` → **Update**
3. 上传 `.vsix`

> 备选：配置 Azure DevOps PAT 后可用 `npx vsce publish` 一键发布。

---

## Commit Message Style

普通提交遵循以下风格（参考 `0782748`）：

### Subject

- 纯中文，不加前缀（不用 `feat:`、`fix:`、`v0.2.3:` 等）。
- 简洁描述本次改动做了什么，不加句号。
- 示例：`完善 Claude Code Bash 回退与 README 说明`

### Body

按功能领域分节，每节一个中文标题，标题下用 `- ` 开头的要点列表：

```
<领域标题>

- <动词><具体内容>，<目的/原因>。
- <动词><具体内容>，<目的/原因>。

<另一个领域标题>

- ...
```

- 每个要点是一句完整的中文，以 `。` 结尾。
- 节与节之间用空行分隔。
- 标题与第一个要点之间不加空行。

> ⚠️ **Windows 环境下不要用多个 `-m` 提交多行 body。** cmd 会把 `-m` 参数中的换行当作命令分隔符，导致 body 被截断。多行 body 必须用文件方式提交：
> ```bash
> # 先写提交信息到临时文件
> cat > .git/COMMIT_MSG_TMP << 'EOF'
> <完整提交信息>
> EOF
> 
> # 再用文件提交
> git commit -F .git/COMMIT_MSG_TMP
> ```

### 验证

最后一节固定为「验证」，列出实际执行的验证命令：

```
验证

- npm.cmd run build
- npm.cmd test
```

### 版本发布提交

版本发布提交（Step 9）使用简化格式：`v0.2.1：<变更摘要>`，不加 body。

---

## 开发调试方法

VSCode 会积极缓存扩展文件。本地开发时：

```bash
# 修改源码后快速更新
npm run build
cp dist/extension.js ~/.vscode/extensions/hcdb.bashterm-mcp-server-<版本号>/dist/extension.js
# 然后执行 "Developer: Reload Window"

# 如果 Reload 没生效，完全关闭再重新打开 VSCode
```
