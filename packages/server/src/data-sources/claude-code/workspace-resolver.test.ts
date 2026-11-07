// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import {
  CLAUDE_CODE_NO_FOLDER_REASON,
  resolveSessionWorkspace,
  resolveTurnStartedAt,
  resolveTurnWorkspace,
} from "./workspace-resolver.js";

// Real Claude Code entries carry cwd, gitBranch and timestamp on every
// user, assistant, system and attachment line (checked against a real
// session log on 2026-11-05, where cwd moved between folders of one repo).
function user(uuid: string, extra: Record<string, unknown> = {}): ClaudeCodeRawEntry {
  return { type: "user", uuid, parentUuid: null, message: { role: "user", content: "hi" }, ...extra };
}

describe("resolveSessionWorkspace", () => {
  it("takes the first entry's folder and branch", () => {
    const entries = [
      { type: "queue-operation", timestamp: "2026-09-01T10:00:00.000Z" },
      user("u1", { cwd: "/home/dev/project", gitBranch: "main" }),
      user("u2", { cwd: "/home/dev/project/packages/server", gitBranch: "main" }),
    ];

    expect(resolveSessionWorkspace(entries)).toEqual({ known: true, cwd: "/home/dev/project", branch: "main" });
  });

  it("keeps the folder when the entry has no branch (not a git repository)", () => {
    expect(resolveSessionWorkspace([user("u1", { cwd: "/tmp/scratch", gitBranch: "" })])).toEqual({ known: true, cwd: "/tmp/scratch" });
  });

  it("skips entries whose cwd isn't a non-empty string", () => {
    const entries = [user("u0", { cwd: 42 }), user("u1", { cwd: "  " }), user("u2", { cwd: "/home/dev/app" })];

    expect(resolveSessionWorkspace(entries)).toEqual({ known: true, cwd: "/home/dev/app" });
  });

  it("is unknown, with the reason, when no entry records a folder", () => {
    expect(resolveSessionWorkspace([user("u1")])).toEqual({ known: false, reason: CLAUDE_CODE_NO_FOLDER_REASON });
    expect(resolveSessionWorkspace([])).toEqual({ known: false, reason: CLAUDE_CODE_NO_FOLDER_REASON });
  });
});

describe("resolveTurnWorkspace", () => {
  const session = { known: true as const, cwd: "/home/dev/project", branch: "main" };

  it("is absent when the turn ran where the session did", () => {
    const group = { userMessageEntry: user("u1", { cwd: "/home/dev/project", gitBranch: "main" }), entries: [] };

    expect(resolveTurnWorkspace(group, session)).toBeUndefined();
  });

  it("is the turn's own folder when it moved", () => {
    const group = { userMessageEntry: user("u2", { cwd: "/home/dev/project/packages/server", gitBranch: "main" }), entries: [] };

    expect(resolveTurnWorkspace(group, session)).toEqual({ known: true, cwd: "/home/dev/project/packages/server", branch: "main" });
  });

  it("is the turn's own workspace when only the branch changed", () => {
    const group = { userMessageEntry: user("u3", { cwd: "/home/dev/project", gitBranch: "feature/x" }), entries: [] };

    expect(resolveTurnWorkspace(group, session)).toEqual({ known: true, cwd: "/home/dev/project", branch: "feature/x" });
  });

  it("is absent when the turn's entry records no folder", () => {
    expect(resolveTurnWorkspace({ userMessageEntry: user("u4"), entries: [] }, session)).toBeUndefined();
  });

  it("is the turn's folder when the session's is unknown", () => {
    const group = { userMessageEntry: user("u5", { cwd: "/home/dev/app" }), entries: [] };

    expect(resolveTurnWorkspace(group, { known: false, reason: "x" })).toEqual({ known: true, cwd: "/home/dev/app" });
  });
});

describe("resolveTurnStartedAt", () => {
  it("is the user message's timestamp", () => {
    const group = { userMessageEntry: user("u1", { timestamp: "2026-09-01T10:00:01.000Z" }), entries: [] };

    expect(resolveTurnStartedAt(group)).toBe("2026-09-01T10:00:01.000Z");
  });

  it("is absent when the timestamp is missing or not a string", () => {
    expect(resolveTurnStartedAt({ userMessageEntry: user("u1"), entries: [] })).toBeUndefined();
    expect(resolveTurnStartedAt({ userMessageEntry: user("u1", { timestamp: 17 }), entries: [] })).toBeUndefined();
  });
});
