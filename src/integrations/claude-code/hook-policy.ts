export interface ClaudeBashDecision {
  allowBuiltInBash: boolean;
  reason: string;
}

const SIMPLE_COMMANDS =
  /^(pwd|date|whoami|hostname|uname|ver|echo|ls|dir|cat|type|head|tail|grep|rg|find|which|where)$/;
const SAFE_GIT_SUBCOMMANDS =
  /^(status|diff|log|show|branch|rev-parse|ls-files)$/;
const VERSION_COMMANDS =
  /^(node|npm|pnpm|yarn|python|python3|pip|pip3|go|cargo|rustc|java|javac)$/;

export function decideClaudeBashCommand(command: string): ClaudeBashDecision {
  const normalized = command.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return {
      allowBuiltInBash: true,
      reason: "empty command",
    };
  }

  if (normalized.includes("\n")) {
    return {
      allowBuiltInBash: false,
      reason: "multi-line command",
    };
  }

  if (/[;&|]{1,2}/.test(normalized)) {
    return {
      allowBuiltInBash: false,
      reason: "contains shell control operator",
    };
  }

  if (/[<>]/.test(normalized)) {
    return {
      allowBuiltInBash: false,
      reason: "contains redirection",
    };
  }

  const words = normalized.split(/\s+/);
  const first = stripQuotes(words[0] || "").toLowerCase();
  const second = stripQuotes(words[1] || "").toLowerCase();

  if (SIMPLE_COMMANDS.test(first)) {
    return {
      allowBuiltInBash: true,
      reason: "simple read-only command",
    };
  }

  if (first === "git" && SAFE_GIT_SUBCOMMANDS.test(second)) {
    return {
      allowBuiltInBash: true,
      reason: "read-only git command",
    };
  }

  if (
    VERSION_COMMANDS.test(first) &&
    words.some((word) => /^(-v|--version|version)$/.test(word.toLowerCase()))
  ) {
    return {
      allowBuiltInBash: true,
      reason: "version query",
    };
  }

  return {
    allowBuiltInBash: false,
    reason: "complex or mutating command",
  };
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}
