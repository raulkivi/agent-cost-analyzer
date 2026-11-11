// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { toSessionListViewModel } from "./session-list.js";

const session = (overrides: Record<string, unknown> = {}) => ({
  id: "7f3a9c2e-1111-4222-8333-444455556666",
  title: "Refactor billing exporter",
  startedAt: "2026-11-10T14:12:00Z",
  turnCount: 42,
  model: "claude-sonnet-5.5",
  repositoryKey: "github.com/example-org/provider-core",
  projectId: null,
  ...overrides,
});

describe("toSessionListViewModel", () => {
  it("shows title, short id, start, turns, model and repository, and no cost", () => {
    const vm = toSessionListViewModel({ total: 6, sessions: [session()] });
    expect(vm.rows).toEqual([
      {
        sessionId: "7f3a9c2e-1111-4222-8333-444455556666",
        title: "Refactor billing exporter",
        shortId: "7f3a9c2e",
        startedText: "Nov 10, 14:12",
        turnsText: "42 turns",
        model: "claude-sonnet-5.5",
        repository: "github.com/example-org/provider-core",
      },
    ]);
    expect(Object.keys(vm.rows[0]!).join()).not.toMatch(/cost|credit/i);
  });

  it("reads a session without a start, a repository or a title honestly", () => {
    const vm = toSessionListViewModel({ total: 1, sessions: [session({ startedAt: undefined, repositoryKey: null, title: "", turnCount: 1 })] });
    expect(vm.rows[0]).toMatchObject({ title: "Untitled session", turnsText: "1 turn" });
    expect(vm.rows[0]!.startedText).toBeUndefined();
    expect(vm.rows[0]!.repository).toBeUndefined();
  });

  it("does not need a repository field (a server without attribution)", () => {
    const bare = session();
    delete (bare as { repositoryKey?: unknown }).repositoryKey;
    expect(toSessionListViewModel({ total: 1, sessions: [bare] }).rows[0]!.repository).toBeUndefined();
  });

  it("says how many of the matches are shown", () => {
    expect(toSessionListViewModel({ total: 6, sessions: Array.from({ length: 6 }, (_, i) => session({ id: `s${i}` })) }).summaryText).toBe("6 of 6 sessions · most recent first");
    expect(toSessionListViewModel({ total: 134, sessions: Array.from({ length: 20 }, (_, i) => session({ id: `s${i}` })) }).summaryText).toBe("20 of 134 sessions · most recent first");
  });

  it("says what to try when nothing matches", () => {
    const vm = toSessionListViewModel({ total: 0, sessions: [] });
    expect(vm.rows).toEqual([]);
    expect(vm.empty).toEqual({ title: "No sessions match", hint: "Try a shorter search, a wider date range or another repository." });
  });

  it("shortens an id to eight characters and keeps a short one whole", () => {
    const vm = toSessionListViewModel({ total: 2, sessions: [session({ id: "abcdef012345" }), session({ id: "slug-7" })] });
    expect(vm.rows.map((row) => row.shortId)).toEqual(["abcdef01", "slug-7"]);
  });
});
