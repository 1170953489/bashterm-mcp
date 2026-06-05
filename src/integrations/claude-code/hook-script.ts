export const CLAUDE_CODE_HOOK_SCRIPT_NAME = "bashterm-mcp-bash-hook.js";

export const CLAUDE_CODE_HOOK_MESSAGE =
  "Please use BashTerm MCP tools (run / exec / read) for this command. " +
  "Simple read-only commands may use the built-in Bash tool, but long-running, interactive, or mutating commands should execute visibly in VSCode terminal tabs.";

export function createClaudeCodeHookScript(): string {
  return String.raw`#!/usr/bin/env node
const message =
  "Please use BashTerm MCP tools (run / exec / read) for this command. " +
  "Simple read-only commands may use the built-in Bash tool, but long-running, interactive, or mutating commands should execute visibly in VSCode terminal tabs.";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const payload = input.trim() ? JSON.parse(input) : {};
    const command = String(payload.tool_input && payload.tool_input.command || "");
    const decision = decideClaudeBashCommand(command);
    if (decision.allowBuiltInBash) {
      process.exit(0);
    }
    console.error(message + " Reason: " + decision.reason + ".");
    process.exit(2);
  } catch {
    console.error(message + " Reason: invalid hook input.");
    process.exit(2);
  }
});

function decideClaudeBashCommand(command) {
  const normalized = command.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { allowBuiltInBash: true, reason: "empty command" };
  if (normalized.includes("\n")) {
    return { allowBuiltInBash: false, reason: "multi-line command" };
  }
  if (/[;&|]{1,2}/.test(normalized)) {
    return { allowBuiltInBash: false, reason: "contains shell control operator" };
  }
  if (/[<>]/.test(normalized)) {
    return { allowBuiltInBash: false, reason: "contains redirection" };
  }

  const words = normalized.split(/\s+/);
  const first = stripQuotes(words[0] || "").toLowerCase();
  const second = stripQuotes(words[1] || "").toLowerCase();

  if (/^(pwd|date|whoami|hostname|uname|ver|echo|ls|dir|cat|type|head|tail|grep|rg|find|which|where)$/.test(first)) {
    return { allowBuiltInBash: true, reason: "simple read-only command" };
  }
  if (first === "git" && /^(status|diff|log|show|branch|rev-parse|ls-files)$/.test(second)) {
    return { allowBuiltInBash: true, reason: "read-only git command" };
  }
  if (/^(node|npm|pnpm|yarn|python|python3|pip|pip3|go|cargo|rustc|java|javac)$/.test(first)) {
    const isVersionQuery = words.some((word) => /^(-v|--version|version)$/.test(word.toLowerCase()));
    if (isVersionQuery) {
      return { allowBuiltInBash: true, reason: "version query" };
    }
  }

  return { allowBuiltInBash: false, reason: "complex or mutating command" };
}

function stripQuotes(value) {
  return value.replace(/^["']|["']$/g, "");
}
`;
}
