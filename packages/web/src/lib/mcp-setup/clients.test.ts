// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { CLIENT_IDS, CLIENT_LABELS, DEFAULT_CLIENT_ID, installCommandFor, isClientId, notesFor } from "./clients.js";

describe("the client list", () => {
  it("keeps the contract order, with Claude Code first", () => {
    expect(CLIENT_IDS).toEqual(["claude-code", "claude-desktop", "cursor", "vscode", "vscode-insiders", "codex", "gemini"]);
    expect(DEFAULT_CLIENT_ID).toBe("claude-code");
  });

  it("labels each client as the boards do", () => {
    expect(CLIENT_IDS.map((id) => CLIENT_LABELS[id])).toEqual([
      "Claude Code",
      "Claude Desktop",
      "Cursor",
      "VS Code",
      "VS Code Insiders",
      "Codex CLI",
      "Gemini CLI",
    ]);
  });

  it("builds the install command without API data", () => {
    expect(installCommandFor("vscode-insiders")).toBe("npx agent-cost-analyzer mcp install --client vscode-insiders");
  });

  it("recognizes ids and rejects anything else", () => {
    expect(isClientId("cursor")).toBe(true);
    expect(isClientId("emacs")).toBe(false);
    expect(isClientId(null)).toBe(false);
  });

  it("has the board's note per client", () => {
    expect(notesFor("claude-desktop").manual).toMatch(/restart Claude Desktop/);
    expect(notesFor("vscode").manual).toMatch(/AI Credits Analyzer extension is installed: it already/);
    expect(notesFor("vscode-insiders").manual).toMatch(/installed in Insiders/);
    expect(notesFor("codex").manual).toMatch(/no remove command/);
    expect(notesFor("claude-code").manual).toMatch(/user scope/);
    expect(notesFor("cursor").installLink).toMatch(/confirm/);
    expect(notesFor("cursor").manual).toBeUndefined();
  });
});
