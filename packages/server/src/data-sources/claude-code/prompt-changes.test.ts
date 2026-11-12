// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { buildClaudeCodePromptChanges } from "./prompt-changes.js";
import type { ClaudeCodeRound } from "./round-grouper.js";

// Phase 16 SR6 (docs/plans/savings-report.md §4 O3, §15 d): Claude Code's
// prompt-change signals per request, against the previous request of the same
// querySource: a changed `shapeHash` is "tools changed", a changed
// `instructions` attachment is "instructions changed"; the system prompt is
// not recorded. Hashes and flags only: file content never leaves the reader.

const apiRequest = (id: string, querySource: string, shapeHash: string): ClaudeCodeRawEntry => ({ type: "api-request", id, querySource, shapeHash });
const instructions = (uuid: string, ...files: { path: string; content: string }[]): ClaudeCodeRawEntry => ({
  type: "attachment",
  uuid,
  attachment: { type: "instructions", files: files.map((file) => ({ ...file, type: "Project" })) },
});
const message = (uuid: string, requestRef: string): ClaudeCodeRawEntry => ({ type: "assistant", uuid, requestRef, message: { id: `m-${requestRef}` } });
const round = (entry: ClaudeCodeRawEntry): ClaudeCodeRound => ({ messageId: `m-${entry.requestRef as string}`, entries: [entry] });

function changes(branch: ClaudeCodeRawEntry[], entries: ClaudeCodeRawEntry[]) {
  const rounds = branch.filter((entry) => entry.type === "assistant").map(round);
  return buildClaudeCodePromptChanges({ rounds, branch, entries });
}

describe("buildClaudeCodePromptChanges", () => {
  it("marks tools changed when the shapeHash differs from the previous request of the same querySource", () => {
    const branch = [message("a1", "r1"), message("a2", "r2"), message("a3", "r3")];
    const entries = [apiRequest("r1", "repl_main_thread", "h1"), apiRequest("r2", "repl_main_thread", "h1"), apiRequest("r3", "repl_main_thread", "h2"), ...branch];

    const result = changes(branch, entries);

    expect(result.get(0)).toBeUndefined();
    expect(result.get(1)).toEqual({ tools: false });
    expect(result.get(2)).toEqual({ tools: true });
  });

  it("keeps one chain per querySource: another source's request is not the previous one", () => {
    const branch = [message("a1", "r1"), message("a2", "r2"), message("a3", "r3")];
    const entries = [apiRequest("r1", "repl_main_thread", "h1"), apiRequest("r2", "compact", "other"), apiRequest("r3", "repl_main_thread", "h1")];

    const result = changes(branch, entries);

    expect(result.get(1)).toBeUndefined();
    expect(result.get(2)).toEqual({ tools: false });
  });

  it("marks instructions changed when the instructions attachment in force differs, by content", () => {
    const branch = [
      instructions("i1", { path: "/p/CLAUDE.md", content: "one" }),
      message("a1", "r1"),
      message("a2", "r2"),
      instructions("i2", { path: "/p/CLAUDE.md", content: "two" }),
      message("a3", "r3"),
      instructions("i3", { path: "/p/CLAUDE.md", content: "two" }),
      message("a4", "r4"),
    ];
    const entries = ["r1", "r2", "r3", "r4"].map((id) => apiRequest(id, "repl_main_thread", "h1"));

    const result = changes(branch, entries);

    expect(result.get(1)).toEqual({ tools: false, instructions: false });
    expect(result.get(2)).toEqual({ tools: false, instructions: true });
    expect(result.get(3)).toEqual({ tools: false, instructions: false });
  });

  it("records nothing for a request whose api-request line or shape is missing", () => {
    const branch = [message("a1", "r1"), message("a2", "r2"), message("a3", "missing")];
    const entries = [apiRequest("r1", "repl_main_thread", "h1"), { type: "api-request", id: "r2", querySource: "repl_main_thread" } as ClaudeCodeRawEntry];

    expect(changes(branch, entries).size).toBe(0);
  });

  it("never records the system prompt, and keeps no file text in a marker", () => {
    const branch = [instructions("i1", { path: "/p/CLAUDE.md", content: "SECRET RULES" }), message("a1", "r1"), message("a2", "r2")];
    const entries = [apiRequest("r1", "s", "h1"), apiRequest("r2", "s", "h1")];

    const marker = changes(branch, entries).get(1);

    expect(marker).not.toHaveProperty("systemPrompt");
    expect(JSON.stringify([...changes(branch, entries)])).not.toContain("SECRET");
  });
});
