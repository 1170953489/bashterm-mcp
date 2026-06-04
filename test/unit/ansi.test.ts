import { describe, it, expect } from "vitest";
import { cleanOutput, stripCommandEcho } from "../../src/utils/ansi.js";

describe("cleanOutput", () => {
  describe("ANSI CSI/SGR sequences", () => {
    it("should strip color codes", () => {
      expect(cleanOutput("\x1b[32mgreen\x1b[0m")).toBe("green");
    });

    it("should strip bold/italic codes", () => {
      expect(cleanOutput("\x1b[1mbold\x1b[0m")).toBe("bold");
      expect(cleanOutput("\x1b[3mitalic\x1b[0m")).toBe("italic");
    });

    it("should strip complex CSI sequences", () => {
      expect(cleanOutput("\x1b[1;32mhello\x1b[0m world")).toBe("hello world");
    });

    it("should strip cursor movement sequences", () => {
      expect(cleanOutput("\x1b[2J\x1b[Hhello")).toBe("hello");
    });

    it("should handle text without any ANSI codes", () => {
      expect(cleanOutput("plain text")).toBe("plain text");
    });

    it("should strip ANSI codes interspersed in text", () => {
      const input = "line1\x1b[0m\nline2\x1b[32m\nline3";
      expect(cleanOutput(input)).toBe("line1\nline2\nline3");
    });
  });

  describe("OSC sequences", () => {
    it("should strip OSC window title sequences", () => {
      // \x1b]0;title\x07 = "set window title to 'title'"
      expect(cleanOutput("\x1b]0;My Title\x07output")).toBe("output");
    });

    it("should strip OSC sequences in the middle of output", () => {
      expect(cleanOutput("before\x1b]0;title\x07after")).toBe("beforeafter");
    });

    it("should strip multiple OSC sequences", () => {
      const input = "\x1b]0;A\x07line1\n\x1b]0;B\x07line2";
      expect(cleanOutput(input)).toBe("line1\nline2");
    });
  });

  describe("line ending normalization", () => {
    it("should normalize Windows CRLF to LF", () => {
      expect(cleanOutput("line1\r\nline2\r\nline3")).toBe("line1\nline2\nline3");
    });

    it("should strip bare CR characters", () => {
      // Some platforms generate bare \r for progress bars, etc.
      expect(cleanOutput("progress: 50%\rprogress: 100%")).toBe(
        "progress: 50%progress: 100%",
      );
    });

    it("should handle mixed line endings", () => {
      // \r\n → \n, then bare \r → removed (not a line break)
      // a\r\nb\nc\rd\r\ne → a\nb\nc\rd\ne → a\nb\ncd\ne
      const input = "a\r\nb\nc\rd\r\ne";
      expect(cleanOutput(input)).toBe("a\nb\ncd\ne");
    });

    it("should trim trailing whitespace and newlines", () => {
      expect(cleanOutput("hello\n\n  ")).toBe("hello");
      expect(cleanOutput("  hello world  ")).toBe("hello world");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      expect(cleanOutput("")).toBe("");
    });

    it("should handle string with only ANSI codes", () => {
      expect(cleanOutput("\x1b[32m\x1b[0m")).toBe("");
    });

    it("should handle multiline with ANSI codes throughout", () => {
      // cleanOutput strips ANSI codes and normalizes line endings.
      // It does NOT strip whitespace within lines (only trims the whole result).
      const input = "\x1b[1mHeader\x1b[0m\r\n\x1b[32m  OK  \x1b[0m\r\n\x1b[31m FAIL \x1b[0m";
      expect(cleanOutput(input)).toBe("Header\n  OK  \n FAIL");
    });

    it("should preserve intentional whitespace in content", () => {
      expect(cleanOutput("col1\tcol2\tcol3")).toBe("col1\tcol2\tcol3");
    });
  });
});

describe("stripCommandEcho", () => {
  it("should remove command echo when first line matches", () => {
    const output = "ls -la\nfile1.txt\nfile2.txt";
    expect(stripCommandEcho(output, "ls -la")).toBe("file1.txt\nfile2.txt");
  });

  it("should not remove first line when it differs from command", () => {
    const output = "some output\nmore output";
    expect(stripCommandEcho(output, "ls -la")).toBe("some output\nmore output");
  });

  it("should match even if command has extra whitespace", () => {
    // Both trimmed before comparison
    const output = "ls -la\nfile1.txt";
    expect(stripCommandEcho(output, "  ls -la  ")).toBe("file1.txt");
  });

  it("should match even if first line has extra whitespace", () => {
    const output = "  npm test  \nresult";
    expect(stripCommandEcho(output, "npm test")).toBe("result");
  });

  it("should handle single-line output that matches the command", () => {
    const output = "echo hello";
    expect(stripCommandEcho(output, "echo hello")).toBe("");
  });

  it("should handle single-line output that differs from command", () => {
    const output = "hello world";
    expect(stripCommandEcho(output, "echo hello")).toBe("hello world");
  });

  it("should handle empty output", () => {
    expect(stripCommandEcho("", "ls")).toBe("");
  });

  it("should handle multiline command echo with subsequent blank lines", () => {
    // First line "git status" is stripped, then .trim() removes the leading blank line
    const output = "git status\n\nOn branch master";
    expect(stripCommandEcho(output, "git status")).toBe("On branch master");
  });
});
