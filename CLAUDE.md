# Project: bashterm-mcp

MCP server that runs commands in visible VSCode terminal tabs.

## Release Process

When publishing a new version, follow these steps in order:

### 1. Update version

```bash
# In package.json, bump the version
# e.g., "version": "0.1.6" → "version": "0.1.7"
```

### 2. Update CHANGELOG.md

Add a new entry at the top with the new version and date:

```markdown
## [0.1.7] - YYYY-MM-DD

### Added
- ...

### Fixed
- ...
```

### 3. Update README.md

Replace the "Latest Changes" section with the new version's changes. Keep only the latest version in README — full history lives in CHANGELOG.md.

### 4. Build and publish

```bash
# Build
npm run build

# Publish to npm
npm publish --access public

# Package vsix
npx vsce package --allow-missing-repository

# Install locally for testing
cp dist/extension.js dist/mcp-entry.js ~/.vscode/extensions/hcdb.bashterm-mcp-<version>/dist/
```

### 5. Upload to VSCode Marketplace

1. Go to https://marketplace.visualstudio.com/manage/publishers/hcdb
2. Click "..." next to Terminal MCP → "Update"
3. Upload the `.vsix` file

### 6. Commit and push

```bash
git add -A
git commit -m "v0.1.7: <summary of changes>"
git push
```

## Extension Cache Workaround

VSCode aggressively caches extensions. When developing locally:

```bash
# Quick update (after modifying source)
npm run build
cp dist/extension.js ~/.vscode/extensions/hcdb.bashterm-mcp-<version>/dist/extension.js
# Then "Developer: Reload Window"

# If reload doesn't pick up changes, close and reopen VSCode completely
```

## Terminal Execution

Prefer the BashTerm MCP tools (`run`, `exec`, `read`, etc.) over the built-in Bash tool for executing commands. BashTerm runs commands in visible VSCode terminal tabs where the user can see output in real time.

For commands that may take longer than 30 seconds or produce large output, use pull mode:
1. Call `run` with `waitForCompletion: false`
2. Call `read` with `offset: -10` to check progress
3. Repeat until done
