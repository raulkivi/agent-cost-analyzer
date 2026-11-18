// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { shellLine, shellQuote } from "../../src/mcp-setup/shell-quote.js";

describe("shellQuote", () => {
  it("leaves safe words bare", () => {
    expect(shellQuote("agent-cost-analyzer@1.0.0")).toBe(
      "agent-cost-analyzer@1.0.0",
    );
  });
  it("quotes spaces, braces and empty strings", () => {
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote('{"a":1}')).toBe(`'{"a":1}'`);
    expect(shellQuote("")).toBe("''");
  });
  it("escapes single quotes", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
  it("joins an argv", () => {
    expect(shellLine(["claude", "mcp", "add", "x y"])).toBe(
      "claude mcp add 'x y'",
    );
  });
});
