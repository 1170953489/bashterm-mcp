import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDiscoveryEntry,
  getSocketPathForWorkspace,
  publishDiscoveryEntry,
  readDiscoveryRegistry,
  removeDiscoveryEntry,
  selectDiscoveryEntry,
} from "../../src/utils/discovery.js";

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bashterm-discovery-"));
  cleanupDirs.push(dir);
  return dir;
}

describe("discovery registry", () => {
  it("publishes entries to the registry", () => {
    const tmpDir = makeTempDir();
    const workspace = path.join(tmpDir, "workspace");
    const socketPath = path.join(tmpDir, "bashterm.sock");
    fs.mkdirSync(workspace);
    fs.writeFileSync(socketPath, "");

    const entry = createDiscoveryEntry({
      socketPath,
      workspacePath: workspace,
      platform: "linux",
      pid: 123,
      now: 1000,
    });

    const registry = publishDiscoveryEntry(entry, { tmpDir });

    expect(registry.entries).toHaveLength(1);
    expect(readDiscoveryRegistry({ tmpDir }).entries[0]).toMatchObject({
      id: entry.id,
      socketPath,
      workspacePath: workspace,
    });
  });

  it("selects the entry whose workspace contains the current cwd", () => {
    const tmpDir = makeTempDir();
    const workspaceA = path.join(tmpDir, "a");
    const workspaceB = path.join(tmpDir, "b");
    const nestedB = path.join(workspaceB, "src", "pkg");
    fs.mkdirSync(nestedB, { recursive: true });
    fs.mkdirSync(workspaceA, { recursive: true });
    const socketA = path.join(tmpDir, "a.sock");
    const socketB = path.join(tmpDir, "b.sock");
    fs.writeFileSync(socketA, "");
    fs.writeFileSync(socketB, "");

    publishDiscoveryEntry(
      createDiscoveryEntry({
        socketPath: socketA,
        workspacePath: workspaceA,
        platform: "linux",
        pid: 1,
        now: 3000,
      }),
      { tmpDir },
    );
    publishDiscoveryEntry(
      createDiscoveryEntry({
        socketPath: socketB,
        workspacePath: workspaceB,
        platform: "linux",
        pid: 2,
        now: 2000,
      }),
      { tmpDir },
    );

    const selection = selectDiscoveryEntry({
      tmpDir,
      cwd: nestedB,
      platform: "linux",
    });

    expect(selection.source).toBe("registry");
    expect(selection.socketPath).toBe(socketB);
    expect(selection.selected?.workspacePath).toBe(workspaceB);
  });

  it("ignores stale Unix socket entries and falls back to the default socket", () => {
    const tmpDir = makeTempDir();
    const workspace = path.join(tmpDir, "workspace");
    const staleSocket = path.join(tmpDir, "stale.sock");
    fs.mkdirSync(workspace);

    publishDiscoveryEntry(
      createDiscoveryEntry({
        socketPath: staleSocket,
        workspacePath: workspace,
        platform: "linux",
        pid: 1,
      }),
      { tmpDir },
    );

    const selection = selectDiscoveryEntry({
      tmpDir,
      cwd: workspace,
      platform: "linux",
    });

    expect(selection.source).toBe("fallback");
    expect(selection.validEntries).toHaveLength(0);
    expect(selection.socketPath).toBe(path.join(tmpDir, "bashterm-mcp.sock"));
  });

  it("removes entries by id", () => {
    const tmpDir = makeTempDir();
    const workspace = path.join(tmpDir, "workspace");
    const socketPath = path.join(tmpDir, "bashterm.sock");
    fs.mkdirSync(workspace);
    fs.writeFileSync(socketPath, "");

    const entry = createDiscoveryEntry({
      socketPath,
      workspacePath: workspace,
      platform: "linux",
      pid: 123,
    });
    publishDiscoveryEntry(entry, { tmpDir });

    removeDiscoveryEntry(entry.id, { tmpDir });

    expect(readDiscoveryRegistry({ tmpDir }).entries).toHaveLength(0);
  });

  it("builds platform-specific socket paths", () => {
    const tmpDir = makeTempDir();
    const workspace = path.join(tmpDir, "workspace");

    expect(getSocketPathForWorkspace(workspace, "linux", { tmpDir })).toMatch(
      /bashterm-mcp-[a-f0-9]{8}\.sock$/,
    );
    expect(getSocketPathForWorkspace(workspace, "win32", { tmpDir })).toContain(
      "bashterm-mcp-",
    );
  });
});
