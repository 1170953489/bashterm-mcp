import * as path from "path";
import {
  getCmdShellPath,
  resolvePowerShellPath,
  type PowerShellPreference,
} from "./shell.js";

export type WindowsShellKind = "cmd" | "powershell" | "pwsh";
export type WindowsExecutionMode = "script" | "raw";
export type WindowsCaptureMode =
  | "cmdExitFile"
  | "powershellExitFile"
  | "fireAndForget";
export type WindowsSyntaxKind = WindowsShellKind | "unknown" | "conflict";

export interface WindowsCommandSyntax {
  kind: WindowsSyntaxKind;
  cmdReasons: string[];
  powershellReasons: string[];
}

export interface WindowsCommandPlan {
  shellKind: WindowsShellKind;
  shellPath: string;
  cwd?: string;
  command: string;
  executionMode: WindowsExecutionMode;
  captureMode: WindowsCaptureMode;
  reason: string;
  syntax: WindowsCommandSyntax;
}

export interface WindowsCommandPlanOptions {
  command: string;
  cwd?: string;
  shell?: string;
  waitForCompletion?: boolean;
  preferredPowerShell?: PowerShellPreference;
  platform?: NodeJS.Platform;
}

export function planWindowsCommand(
  options: WindowsCommandPlanOptions,
): WindowsCommandPlan {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    throw new Error("Windows command planner can only run on Windows");
  }

  const normalized = normalizeCommand(options.command);
  const rewritten = rewriteLeadingCd(normalized, options.cwd);
  const syntax = analyzeWindowsCommandSyntax(rewritten.command);
  const explicitShellKind = options.shell
    ? normalizeWindowsShellKind(options.shell)
    : undefined;

  if (!explicitShellKind && syntax.kind === "conflict") {
    throw new Error(
      `Conflicting Windows shell syntax: cmd (${syntax.cmdReasons.join(", ")}) and PowerShell (${syntax.powershellReasons.join(", ")})`,
    );
  }

  const shellKind =
    explicitShellKind ??
    (syntax.kind === "powershell"
      ? (options.preferredPowerShell ?? "powershell")
      : "cmd");

  const waitForCompletion = options.waitForCompletion ?? true;
  const executionMode: WindowsExecutionMode = waitForCompletion
    ? "script"
    : "raw";
  const captureMode: WindowsCaptureMode = waitForCompletion
    ? shellKind === "cmd"
      ? "cmdExitFile"
      : "powershellExitFile"
    : "fireAndForget";
  const shellPath =
    shellKind === "cmd" ? getCmdShellPath() : resolvePowerShellPath(shellKind);

  return {
    shellKind,
    shellPath,
    cwd: rewritten.cwd,
    command: rewritten.command,
    executionMode,
    captureMode,
    reason: describePlan(
      shellKind,
      explicitShellKind,
      syntax,
      rewritten.changed,
    ),
    syntax,
  };
}

export function analyzeWindowsCommandSyntax(
  command: string,
): WindowsCommandSyntax {
  const normalized = normalizeCommand(command);
  const cmdReasons: string[] = [];
  const powershellReasons: string[] = [];

  if (/\.(cmd|bat)(\s|$)/i.test(normalized)) {
    cmdReasons.push("invokes .cmd/.bat script");
  }
  if (/\bcmd(\.exe)?\s+\/[cd]\b/i.test(normalized)) {
    cmdReasons.push("invokes cmd /c or cmd /d");
  }
  if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(normalized)) {
    cmdReasons.push("uses %VAR% environment variable syntax");
  }
  if (/^\s*set\s+[A-Za-z_][A-Za-z0-9_]*=/im.test(normalized)) {
    cmdReasons.push("uses cmd set VAR=value syntax");
  }
  if (/(^|[&|\n]\s*)dir\s+\/[a-z]/i.test(normalized)) {
    cmdReasons.push("uses cmd dir slash switches");
  }
  if (
    /(^|[&|\n]\s*)(copy|xcopy|del|erase|type|where)(?!-)\b/i.test(normalized)
  ) {
    cmdReasons.push("uses cmd built-in command");
  }
  if (/(^|[^&|])(&&|\|\|)([^&|]|$)/.test(normalized)) {
    cmdReasons.push("uses cmd-style command chaining");
  }
  if (/\^\s*(\n|$)/.test(normalized)) {
    cmdReasons.push("uses cmd caret line continuation");
  }
  if (/(^|[^\d])\d?>&\d/.test(normalized)) {
    cmdReasons.push("uses cmd-style descriptor redirection");
  }

  if (/\.ps1(\s|$)/i.test(normalized)) {
    powershellReasons.push("invokes .ps1 script");
  }
  if (/\$env:/i.test(normalized)) {
    powershellReasons.push("uses PowerShell $env: syntax");
  }
  if (/\$[A-Za-z_][A-Za-z0-9_]*/.test(normalized)) {
    powershellReasons.push("uses PowerShell variable syntax");
  }
  if (
    /\b(Get|Set|New|Remove|Test|Select|Where|ForEach|Write|Start|Stop)-[A-Za-z]+\b/i.test(
      normalized,
    )
  ) {
    powershellReasons.push("uses PowerShell cmdlet syntax");
  }
  if (/\|\s*(Where-Object|ForEach-Object|Select-Object)\b/i.test(normalized)) {
    powershellReasons.push("uses PowerShell pipeline cmdlet");
  }

  if (cmdReasons.length > 0 && powershellReasons.length > 0) {
    return { kind: "conflict", cmdReasons, powershellReasons };
  }
  if (powershellReasons.length > 0) {
    return { kind: "powershell", cmdReasons, powershellReasons };
  }
  if (cmdReasons.length > 0 || normalized.includes("\n")) {
    if (normalized.includes("\n")) {
      cmdReasons.push("uses multiline command");
    }
    return { kind: "cmd", cmdReasons, powershellReasons };
  }

  return { kind: "unknown", cmdReasons, powershellReasons };
}

export function normalizeWindowsShellKind(shell: string): WindowsShellKind {
  const normalized = shell.toLowerCase();
  if (normalized === "cmd" || normalized.endsWith("\\cmd.exe")) return "cmd";
  if (normalized === "powershell" || normalized.endsWith("\\powershell.exe")) {
    return "powershell";
  }
  if (normalized === "pwsh" || normalized.endsWith("\\pwsh.exe")) return "pwsh";
  throw new Error(`Unsupported Windows shell: ${shell}`);
}

export function resolveWindowsShell(
  shell?: string,
  preferredPowerShell: PowerShellPreference = "powershell",
): { shellKind: WindowsShellKind; shellPath: string } {
  const shellKind = shell ? normalizeWindowsShellKind(shell) : "cmd";
  return {
    shellKind,
    shellPath:
      shellKind === "cmd"
        ? getCmdShellPath()
        : resolvePowerShellPath(shellKind === "pwsh" ? "pwsh" : "powershell"),
  };
}

export function isCommandCompatibleWithWindowsShell(
  command: string,
  shellKind: WindowsShellKind,
): { compatible: boolean; reason?: string } {
  const syntax = analyzeWindowsCommandSyntax(command);
  if (syntax.kind === "conflict") {
    return {
      compatible: false,
      reason: `conflicting Windows shell syntax: cmd (${syntax.cmdReasons.join(", ")}) and PowerShell (${syntax.powershellReasons.join(", ")})`,
    };
  }
  if (syntax.kind === "unknown") return { compatible: true };
  if (syntax.kind === shellKind) return { compatible: true };
  if (syntax.kind === "powershell" && shellKind === "pwsh") {
    return { compatible: true };
  }

  return {
    compatible: false,
    reason: `command looks like ${syntax.kind}, but session shell is ${shellKind}`,
  };
}

function normalizeCommand(command: string): string {
  return command.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function rewriteLeadingCd(
  command: string,
  cwd: string | undefined,
): { command: string; cwd?: string; changed: boolean } {
  const chained = command.match(
    /^\s*cd\s+(?:\/d\s+)?(?:"([^"]+)"|'([^']+)'|([^\n&]+?))\s*&&\s*([\s\S]+)$/i,
  );
  if (chained) {
    const cdTarget = chained[1] ?? chained[2] ?? chained[3].trim();
    return {
      cwd: resolveCdPath(cdTarget, cwd),
      command: chained[4].trim(),
      changed: true,
    };
  }

  const lines = command.split("\n");
  if (lines.length > 1) {
    const firstLine = lines[0].match(
      /^\s*cd\s+(?:\/d\s+)?(?:"([^"]+)"|'([^']+)'|(.+?))\s*$/i,
    );
    if (firstLine) {
      const cdTarget = firstLine[1] ?? firstLine[2] ?? firstLine[3].trim();
      return {
        cwd: resolveCdPath(cdTarget, cwd),
        command: lines.slice(1).join("\n").trim(),
        changed: true,
      };
    }
  }

  return { command, cwd, changed: false };
}

function resolveCdPath(cdTarget: string, baseCwd: string | undefined): string {
  return path.isAbsolute(cdTarget)
    ? path.resolve(cdTarget)
    : path.resolve(baseCwd ?? process.cwd(), cdTarget);
}

function describePlan(
  shellKind: WindowsShellKind,
  explicitShellKind: WindowsShellKind | undefined,
  syntax: WindowsCommandSyntax,
  rewritten: boolean,
): string {
  const parts = [
    explicitShellKind ? `explicit ${shellKind}` : `planned ${shellKind}`,
  ];
  if (syntax.kind !== "unknown") {
    parts.push(`syntax: ${syntax.kind}`);
  } else {
    parts.push("default cmd");
  }
  if (rewritten) parts.push("rewrote leading cd");
  return parts.join("; ");
}
