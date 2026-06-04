import { describe, it, expect } from "vitest";
import {
  buildExecOptions,
  detectShellEncoding,
} from "../../src/utils/exec-options.js";

describe("buildExecOptions", () => {
  const baseParams = {
    cwd: "/home/user/project",
    timeoutMs: 15000,
    isWin: false,
  };

  describe("shell passthrough", () => {
    it("should pass shell path through when specified", () => {
      const options = buildExecOptions({
        ...baseParams,
        shell: "/bin/bash",
      });
      expect(options.shell).toBe("/bin/bash");
    });

    it("should set shell to undefined when not specified (platform default)", () => {
      const options = buildExecOptions(baseParams);
      expect(options.shell).toBeUndefined();
    });

    it("should pass zsh shell path through", () => {
      const options = buildExecOptions({
        ...baseParams,
        shell: "/bin/zsh",
      });
      expect(options.shell).toBe("/bin/zsh");
    });

    it("should pass Windows Git Bash path through", () => {
      const options = buildExecOptions({
        ...baseParams,
        shell: "C:/Program Files/Git/bin/bash.exe",
      });
      expect(options.shell).toBe("C:/Program Files/Git/bin/bash.exe");
    });
  });

  describe("encoding", () => {
    it("should set encoding to null on Windows (for manual TextDecoder)", () => {
      const options = buildExecOptions({
        ...baseParams,
        isWin: true,
      });
      expect(options.encoding).toBeNull();
    });

    it("should set encoding to utf8 on non-Windows", () => {
      const options = buildExecOptions({
        ...baseParams,
        isWin: false,
      });
      expect(options.encoding).toBe("utf8");
    });
  });

  describe("passthrough fields", () => {
    it("should pass cwd through", () => {
      const options = buildExecOptions({
        ...baseParams,
        cwd: "/custom/path",
      });
      expect(options.cwd).toBe("/custom/path");
    });

    it("should pass timeoutMs through as timeout", () => {
      const options = buildExecOptions({
        ...baseParams,
        timeoutMs: 99999,
      });
      expect(options.timeout).toBe(99999);
    });

    it("should always set windowsHide to true", () => {
      const options = buildExecOptions(baseParams);
      expect(options.windowsHide).toBe(true);
    });
  });

  describe("combined behavior", () => {
    it("should produce correct options for Windows with Git Bash", () => {
      const options = buildExecOptions({
        cwd: "C:\\Users\\test\\project",
        timeoutMs: 30000,
        shell: "C:/Program Files/Git/bin/bash.exe",
        isWin: true,
      });
      expect(options).toEqual({
        cwd: "C:\\Users\\test\\project",
        timeout: 30000,
        windowsHide: true,
        encoding: null,
        shell: "C:/Program Files/Git/bin/bash.exe",
      });
    });

    it("should produce correct options for Linux without shell override", () => {
      const options = buildExecOptions({
        cwd: "/home/user/app",
        timeoutMs: 5000,
        isWin: false,
      });
      expect(options).toEqual({
        cwd: "/home/user/app",
        timeout: 5000,
        windowsHide: true,
        encoding: "utf8",
        shell: undefined,
      });
    });
  });
});

describe("detectShellEncoding", () => {
  describe("on Windows", () => {
    it("should return gbk when no shell is specified (cmd.exe)", () => {
      expect(detectShellEncoding(true, undefined)).toBe("gbk");
    });

    it("should return utf-8 for bash", () => {
      expect(detectShellEncoding(true, "C:/Program Files/Git/bin/bash.exe")).toBe("utf-8");
      expect(detectShellEncoding(true, "/bin/bash")).toBe("utf-8");
    });

    it("should return utf-8 for zsh", () => {
      expect(detectShellEncoding(true, "/usr/bin/zsh")).toBe("utf-8");
    });

    it("should return utf-8 for fish", () => {
      expect(detectShellEncoding(true, "C:/msys64/usr/bin/fish.exe")).toBe("utf-8");
    });

    it("should return utf-8 for dash and ksh", () => {
      expect(detectShellEncoding(true, "/bin/dash")).toBe("utf-8");
      expect(detectShellEncoding(true, "/bin/ksh")).toBe("utf-8");
    });

    it("should return utf-8 for sh (generic Unix shell)", () => {
      expect(detectShellEncoding(true, "/bin/sh")).toBe("utf-8");
    });

    it("should return utf-8 for WSL", () => {
      expect(detectShellEncoding(true, "wsl.exe")).toBe("utf-8");
    });

    it("should return utf-8 for pwsh (PowerShell 7+)", () => {
      expect(detectShellEncoding(true, "C:/Program Files/PowerShell/7/pwsh.exe")).toBe("utf-8");
    });

    it("should return gbk for legacy powershell.exe", () => {
      expect(detectShellEncoding(true, "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")).toBe("gbk");
    });

    it("should return gbk for cmd.exe", () => {
      expect(detectShellEncoding(true, "C:/Windows/System32/cmd.exe")).toBe("gbk");
    });
  });

  describe("on non-Windows", () => {
    it("should always return utf-8 regardless of shell", () => {
      expect(detectShellEncoding(false, undefined)).toBe("utf-8");
      expect(detectShellEncoding(false, "/bin/bash")).toBe("utf-8");
      expect(detectShellEncoding(false, "/bin/zsh")).toBe("utf-8");
      expect(detectShellEncoding(false, "/bin/fish")).toBe("utf-8");
    });
  });
});
