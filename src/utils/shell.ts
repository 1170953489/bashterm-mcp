import * as path from "path";

export type WindowsDefaultShell = "vscode" | "cmd" | "powershell" | "pwsh";
export type WindowsShellKind = "cmd" | "powershell" | "unknown";
export type ShellPlanKind = "cmd" | "powershell" | "pwsh" | "vscode";
export type ShellPlanCaptureMode =
  | "shellIntegration"
  | "cmdExitFile"
  | "fireAndForget";
export type ShellResolutionSource = "explicit" | "detected" | "default";

export interface WindowsShellDetection {
  kind: WindowsShellKind;
  confidence: "high" | "low";
  reasons: string[];
}

export interface ResolveShellOptions {
  command?: string;
  enableWindowsShellDetection?: boolean;
  windowsDefaultShell?: WindowsDefaultShell;
  platform?: NodeJS.Platform;
}

export interface ShellResolution {
  shell?: string;
  source: ShellResolutionSource;
  detection?: WindowsShellDetection;
}

export interface ShellPlan {
  shell?: string;
  source: ShellResolutionSource;
  shellKind: ShellPlanKind;
  captureMode: ShellPlanCaptureMode;
  reason: string;
  detection?: WindowsShellDetection;
}

/**
 * Resolve the shell BashTerm should use when the caller didn't provide one.
 * On Windows, "vscode" means leave shellPath unset and let VSCode use the
 * user's configured default terminal profile.
 */
export function resolveDefaultShell(
  platform = process.platform,
  windowsDefaultShell: WindowsDefaultShell = "vscode",
): string | undefined {
  if (platform !== "win32") return undefined;

  switch (windowsDefaultShell) {
    case "cmd":
      return getCmdShellPath();
    case "powershell":
      return path.win32.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
    case "pwsh":
      return "pwsh.exe";
    case "vscode":
    default:
      return undefined;
  }
}

export function resolveShell(
  shell?: string,
  options: ResolveShellOptions = {},
): string | undefined {
  return resolveShellWithMetadata(shell, options).shell;
}

export function resolveShellPlan(
  shell?: string,
  options: ResolveShellOptions = {},
): ShellPlan {
  const platform = options.platform ?? process.platform;
  const resolution = resolveShellWithMetadata(shell, options);
  const shellKind = resolveShellPlanKind(
    shell,
    resolution.shell,
    platform,
    options.windowsDefaultShell ?? "vscode",
    resolution,
  );

  return {
    shell: resolution.shell,
    source: resolution.source,
    shellKind,
    captureMode: shellKind === "cmd" ? "cmdExitFile" : "shellIntegration",
    reason: describeShellResolution(
      shell,
      platform,
      options.windowsDefaultShell ?? "vscode",
      resolution,
    ),
    detection: resolution.detection,
  };
}

export function resolveShellWithMetadata(
  shell?: string,
  options: ResolveShellOptions = {},
): ShellResolution {
  const platform = options.platform ?? process.platform;
  if (shell) {
    return {
      shell: normalizeShellAlias(shell, platform),
      source: "explicit",
    };
  }

  if (
    platform === "win32" &&
    options.enableWindowsShellDetection !== false &&
    options.command
  ) {
    const detection = detectWindowsShellKind(options.command);
    if (detection.confidence === "high" && detection.kind !== "unknown") {
      return {
        shell:
          detection.kind === "cmd"
            ? getCmdShellPath()
            : resolveDefaultShell(platform, "powershell"),
        source: "detected",
        detection,
      };
    }
  }

  return {
    shell: resolveDefaultShell(
      platform,
      options.windowsDefaultShell ?? "vscode",
    ),
    source: "default",
  };
}

export function detectWindowsShellKind(command: string): WindowsShellDetection {
  const normalized = command.replace(/\r\n/g, "\n").trim();
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
  if (/(^|[^\d])\d?>&\d/.test(normalized)) {
    cmdReasons.push("uses cmd-style descriptor redirection");
  }

  if (/\.(ps1)(\s|$)/i.test(normalized)) {
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

  if (powershellReasons.length > 0 && cmdReasons.length === 0) {
    return {
      kind: "powershell",
      confidence: "high",
      reasons: powershellReasons,
    };
  }
  if (cmdReasons.length > 0 && powershellReasons.length === 0) {
    return {
      kind: "cmd",
      confidence: "high",
      reasons: cmdReasons,
    };
  }

  return {
    kind: "unknown",
    confidence: "low",
    reasons: [...cmdReasons, ...powershellReasons],
  };
}

export function isCmdShell(shell?: string): boolean {
  if (!shell) return false;
  return /(^|[\/\\])cmd(\.exe)?$/i.test(shell);
}

function isPowerShellShell(shell?: string): boolean {
  if (!shell) return false;
  return /(^|[\/\\])powershell(\.exe)?$/i.test(shell);
}

function isPwshShell(shell?: string): boolean {
  if (!shell) return false;
  return /(^|[\/\\])pwsh(\.exe)?$/i.test(shell);
}

function getCmdShellPath(): string {
  return (
    process.env.COMSPEC ||
    path.win32.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "cmd.exe",
    )
  );
}

function normalizeShellAlias(
  shell: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") return shell;

  switch (shell.toLowerCase()) {
    case "vscode":
      return undefined;
    case "cmd":
      return getCmdShellPath();
    case "powershell":
      return resolveDefaultShell(platform, "powershell");
    case "pwsh":
      return "pwsh.exe";
    default:
      return shell;
  }
}

function resolveShellPlanKind(
  requestedShell: string | undefined,
  resolvedShell: string | undefined,
  platform: NodeJS.Platform,
  windowsDefaultShell: WindowsDefaultShell,
  resolution: ShellResolution,
): ShellPlanKind {
  if (platform !== "win32") return "vscode";

  const requested = requestedShell?.toLowerCase();
  if (requested === "vscode") return "vscode";
  if (requested === "cmd") return "cmd";
  if (requested === "powershell") return "powershell";
  if (requested === "pwsh") return "pwsh";

  if (resolution.source === "detected" && resolution.detection) {
    return resolution.detection.kind === "cmd" ? "cmd" : "powershell";
  }

  if (isCmdShell(resolvedShell)) return "cmd";
  if (isPwshShell(resolvedShell)) return "pwsh";
  if (isPowerShellShell(resolvedShell)) return "powershell";

  return windowsDefaultShell === "cmd" ||
    windowsDefaultShell === "powershell" ||
    windowsDefaultShell === "pwsh"
    ? windowsDefaultShell
    : "vscode";
}

function describeShellResolution(
  requestedShell: string | undefined,
  platform: NodeJS.Platform,
  windowsDefaultShell: WindowsDefaultShell,
  resolution: ShellResolution,
): string {
  if (resolution.source === "explicit") {
    return `explicit shell: ${requestedShell ?? "vscode"}`;
  }

  if (resolution.source === "detected" && resolution.detection) {
    return `detected ${resolution.detection.kind}: ${resolution.detection.reasons.join(", ")}`;
  }

  if (platform !== "win32") {
    return "platform default shell";
  }

  return `Windows default shell: ${windowsDefaultShell}`;
}
