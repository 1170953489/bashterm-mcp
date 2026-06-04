import { describe, it, expect } from "vitest";
import { formatExecuteResult } from "../../src/mcp/tools/command-utils.js";

describe("formatExecuteResult", () => {
  const baseParams = {
    sessionId: "session-abc",
    timeoutMs: 30000,
  };

  describe("normal execution", () => {
    it("should format command with output and exit code 0", () => {
      const result = formatExecuteResult(
        "Hello World",
        "echo Hello World",
        0,
        false,
        150,
        "session-abc",
        30000,
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("$ echo Hello World");
      expect(result.content[0].text).toContain("Hello World");
      expect(result.content[0].text).toContain("exit: 0");
      expect(result.content[0].text).toContain("150ms");
      expect(result.content[0].text).toContain("session-abc");
      expect(result.isError).toBe(false);
    });

    it("should mark non-zero exit as error", () => {
      const result = formatExecuteResult(
        "error message",
        "failing-command",
        1,
        false,
        200,
        "session-abc",
        30000,
      );

      expect(result.isError).toBe(true);
    });

    it("should mark null exit code as non-error", () => {
      const result = formatExecuteResult(
        "output",
        "some-command",
        null,
        false,
        100,
        "session-abc",
        30000,
      );

      expect(result.isError).toBe(false);
    });
  });

  describe("timeout", () => {
    it("should include timeout message when command timed out", () => {
      const result = formatExecuteResult(
        "partial output...",
        "slow-command",
        null,
        true,
        30100,
        "session-abc",
        30000,
      );

      expect(result.content[0].text).toContain("TIMED OUT");
      expect(result.content[0].text).toContain("30000ms");
      expect(result.content[0].text).toContain("use read to get more output");
    });

    it("should show n/a exit code for timeout", () => {
      const result = formatExecuteResult(
        "",
        "hanging-cmd",
        null,
        true,
        30000,
        "session-abc",
        30000,
      );

      expect(result.content[0].text).toContain("exit: n/a");
    });
  });

  describe("command echo stripping", () => {
    it("should strip command echo from output", () => {
      const result = formatExecuteResult(
        "echo hello\r\nhello world",
        "echo hello",
        0,
        false,
        50,
        "session-abc",
        30000,
      );

      expect(result.content[0].text).not.toContain("$ echo hello\necho hello");
    });

    it("should not strip first line when it is not an echo of the command", () => {
      const result = formatExecuteResult(
        "unrelated output\nmore output",
        "echo hello",
        0,
        false,
        50,
        "session-abc",
        30000,
      );

      expect(result.content[0].text).toContain("unrelated output");
    });
  });

  describe("ANSI cleaning", () => {
    it("should strip ANSI codes from output", () => {
      const result = formatExecuteResult(
        "\x1b[32mOK\x1b[0m",
        "test-cmd",
        0,
        false,
        10,
        "session-abc",
        30000,
      );

      expect(result.content[0].text).toContain("OK");
      expect(result.content[0].text).not.toContain("\x1b");
    });

    it("should strip OSC window title sequences", () => {
      const result = formatExecuteResult(
        "\x1b]0;Terminal Title\x07actual output",
        "cmd",
        0,
        false,
        10,
        "session-abc",
        30000,
      );

      expect(result.content[0].text).toContain("actual output");
      expect(result.content[0].text).not.toContain("\x1b]");
    });
  });

  describe("status line format", () => {
    it("should include all status parts in brackets", () => {
      const result = formatExecuteResult(
        "output",
        "ls -la",
        0,
        false,
        42,
        "sess-123",
        30000,
      );

      const text = result.content[0].text;
      expect(text).toMatch(/\[exit: 0 \| 42ms \| sess-123\]/);
    });

    it("should include the command in the output", () => {
      const result = formatExecuteResult(
        "result",
        "npm test",
        0,
        false,
        100,
        "sess-123",
        30000,
      );

      expect(result.content[0].text).toMatch(/^\$ npm test/);
    });
  });
});
