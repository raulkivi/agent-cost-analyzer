// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { mcpServerToml, tomlString } from "./toml.js";

describe("tomlString", () => {
  it("quotes plain text", () => {
    expect(tomlString("abc")).toBe('"abc"');
  });

  it("escapes quotes and backslashes", () => {
    expect(tomlString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("escapes control characters", () => {
    expect(tomlString("a\nb\tc\u0001")).toBe('"a\\nb\\tc\\u0001"');
  });
});

describe("mcpServerToml", () => {
  it("renders the server table", () => {
    expect(mcpServerToml("agent-cost-analyzer", { command: "npx", args: ["-y", "x"] })).toBe(
      '[mcp_servers.agent-cost-analyzer]\ncommand = "npx"\nargs = ["-y", "x"]\n',
    );
  });

  it("quotes a table key that is not a bare key", () => {
    expect(mcpServerToml("a b", { command: "npx", args: [] })).toContain('[mcp_servers."a b"]');
  });
});
