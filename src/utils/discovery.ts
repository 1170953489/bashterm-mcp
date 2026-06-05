import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const DISCOVERY_REGISTRY_FILE = "bashterm-mcp.discovery.json";
export const DISCOVERY_REGISTRY_VERSION = 1;

export interface DiscoveryEntry {
  id: string;
  socketPath: string;
  workspacePath: string;
  workspaceHash: string;
  platform: NodeJS.Platform;
  pid: number;
  extensionVersion?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DiscoveryRegistry {
  version: number;
  updatedAt: number;
  entries: DiscoveryEntry[];
}

export interface DiscoverySelection {
  registryPath: string;
  entries: DiscoveryEntry[];
  validEntries: DiscoveryEntry[];
  selected?: DiscoveryEntry;
  socketPath: string;
  source: "registry" | "fallback";
  reason: string;
}

export interface DiscoveryPathsOptions {
  tmpDir?: string;
}

export interface DiscoveryEntryOptions extends DiscoveryPathsOptions {
  socketPath: string;
  workspacePath: string;
  platform?: NodeJS.Platform;
  pid?: number;
  extensionVersion?: string;
  now?: number;
}

export interface DiscoverySelectOptions extends DiscoveryPathsOptions {
  cwd?: string;
  platform?: NodeJS.Platform;
}

export function getDiscoveryRegistryPath(
  options: DiscoveryPathsOptions = {},
): string {
  return path.join(options.tmpDir ?? os.tmpdir(), DISCOVERY_REGISTRY_FILE);
}

export function getWorkspaceHash(workspacePath: string): string {
  return crypto
    .createHash("md5")
    .update(workspacePath)
    .digest("hex")
    .slice(0, 8);
}

export function getSocketPathForWorkspace(
  workspacePath: string,
  platform: NodeJS.Platform = process.platform,
  options: DiscoveryPathsOptions = {},
): string {
  const tmpDir = options.tmpDir ?? os.tmpdir();
  const hash = getWorkspaceHash(workspacePath);
  return platform === "win32"
    ? path.join("\\\\?\\pipe", `bashterm-mcp-${hash}`)
    : path.join(tmpDir, `bashterm-mcp-${hash}.sock`);
}

export function createDiscoveryEntry(
  options: DiscoveryEntryOptions,
): DiscoveryEntry {
  const platform = options.platform ?? process.platform;
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now();
  const workspacePath = normalizePath(options.workspacePath);
  const workspaceHash = getWorkspaceHash(workspacePath);

  return {
    id: `${workspaceHash}-${pid}`,
    socketPath: options.socketPath,
    workspacePath,
    workspaceHash,
    platform,
    pid,
    extensionVersion: options.extensionVersion,
    createdAt: now,
    updatedAt: now,
  };
}

export function publishDiscoveryEntry(
  entry: DiscoveryEntry,
  options: DiscoveryPathsOptions = {},
): DiscoveryRegistry {
  const registryPath = getDiscoveryRegistryPath(options);
  const registry = readDiscoveryRegistry(options);
  const entries = registry.entries.filter(
    (existing) =>
      existing.id !== entry.id && existing.socketPath !== entry.socketPath,
  );
  entries.push(entry);

  const nextRegistry: DiscoveryRegistry = {
    version: DISCOVERY_REGISTRY_VERSION,
    updatedAt: entry.updatedAt,
    entries,
  };
  writeJsonAtomic(registryPath, nextRegistry);
  return nextRegistry;
}

export function removeDiscoveryEntry(
  entryId: string,
  options: DiscoveryPathsOptions = {},
): DiscoveryRegistry {
  const registryPath = getDiscoveryRegistryPath(options);
  const registry = readDiscoveryRegistry(options);
  const entries = registry.entries.filter((entry) => entry.id !== entryId);
  const nextRegistry: DiscoveryRegistry = {
    version: DISCOVERY_REGISTRY_VERSION,
    updatedAt: Date.now(),
    entries,
  };
  writeJsonAtomic(registryPath, nextRegistry);
  return nextRegistry;
}

export function readDiscoveryRegistry(
  options: DiscoveryPathsOptions = {},
): DiscoveryRegistry {
  const registryPath = getDiscoveryRegistryPath(options);
  if (!fs.existsSync(registryPath)) {
    return {
      version: DISCOVERY_REGISTRY_VERSION,
      updatedAt: 0,
      entries: [],
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
      throw new Error("Invalid discovery registry shape");
    }
    return {
      version:
        typeof parsed.version === "number"
          ? parsed.version
          : DISCOVERY_REGISTRY_VERSION,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      entries: parsed.entries.filter(isDiscoveryEntry),
    };
  } catch {
    return {
      version: DISCOVERY_REGISTRY_VERSION,
      updatedAt: 0,
      entries: [],
    };
  }
}

export function selectDiscoveryEntry(
  options: DiscoverySelectOptions = {},
): DiscoverySelection {
  const platform = options.platform ?? process.platform;
  const cwd = normalizePath(options.cwd ?? process.cwd());
  const registryPath = getDiscoveryRegistryPath(options);
  const registry = readDiscoveryRegistry(options);
  const validEntries = registry.entries.filter((entry) =>
    isEntryUsable(entry, platform),
  );
  const selected = chooseBestEntry(validEntries, cwd);

  if (selected) {
    return {
      registryPath,
      entries: registry.entries,
      validEntries,
      selected,
      socketPath: selected.socketPath,
      source: "registry",
      reason: `selected registry entry for workspace ${selected.workspacePath}`,
    };
  }

  const fallbackSocketPath =
    platform === "win32"
      ? path.join("\\\\?\\pipe", "bashterm-mcp-default")
      : path.join(options.tmpDir ?? os.tmpdir(), "bashterm-mcp.sock");
  return {
    registryPath,
    entries: registry.entries,
    validEntries,
    socketPath: fallbackSocketPath,
    source: "fallback",
    reason: "no usable discovery entry found",
  };
}

function chooseBestEntry(
  entries: DiscoveryEntry[],
  cwd: string,
): DiscoveryEntry | undefined {
  return entries
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, cwd),
    }))
    .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
    .at(0)?.entry;
}

function scoreEntry(entry: DiscoveryEntry, cwd: string): number {
  const workspace = normalizePath(entry.workspacePath);
  if (!workspace) return 10;
  if (cwd === workspace) return 3000 + workspace.length;
  if (isPathInside(cwd, workspace)) return 2000 + workspace.length;
  return 0;
}

function isEntryUsable(
  entry: DiscoveryEntry,
  platform: NodeJS.Platform,
): boolean {
  if (entry.platform !== platform) return false;
  if (platform === "win32") return true;
  return fs.existsSync(entry.socketPath);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(
      tempPath,
      Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8"),
    );
    fs.renameSync(tempPath, filePath);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Ignore temporary file cleanup errors.
    }
  }
}

function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normalizePath(value: string): string {
  return path.resolve(value || "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDiscoveryEntry(value: unknown): value is DiscoveryEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.socketPath === "string" &&
    typeof value.workspacePath === "string" &&
    typeof value.workspaceHash === "string" &&
    typeof value.platform === "string" &&
    typeof value.pid === "number" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}
