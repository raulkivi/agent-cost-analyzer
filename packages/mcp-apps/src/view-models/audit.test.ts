// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { auditRollup, sessionAudit } from "./audit-fixtures.js";
import { toAuditRollupViewModel, toSessionAuditViewModel } from "./audit.js";

const none = { toolCalls: 0, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 0 };

describe("toSessionAuditViewModel tiles", () => {
  it("counts failures over known outcomes and keeps unknown outcomes apart", () => {
    const vm = toSessionAuditViewModel(sessionAudit());
    expect(vm.tiles.toolCalls).toMatchObject({ text: "118", note: "across 42 turns" });
    expect(vm.tiles.failed).toMatchObject({ text: "14", note: "error 11 · interrupted 2 · denied 1" });
    expect(vm.tiles.failureRate).toMatchObject({ text: "12.6 %", note: "of 111 calls with a known outcome" });
    expect(vm.tiles.unknown).toMatchObject({ text: "7", note: "calls: not counted as success or failure" });
  });

  it("names the session, its id and start", () => {
    const vm = toSessionAuditViewModel(sessionAudit());
    expect(vm.title).toBe("Add retry to export job");
    expect(vm.metaText).toBe("session 5b91d0c4 · Nov 9");
  });

  it("reads Unknown, never 0, when no outcome is known", () => {
    const vm = toSessionAuditViewModel(
      sessionAudit({ totals: { toolCalls: 5, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 5 }, failureRate: null, outcomeCoverage: { known: 0, unknown: 5, unknownReasons: [] }, byFailureCategory: [] }),
    );
    expect(vm.tiles.failureRate).toMatchObject({ text: "Unknown", known: false });
    expect(vm.tiles.failed).toMatchObject({ text: "Unknown", known: false });
    expect(vm.tiles.unknown.text).toBe("5");
  });

  it("reads Unknown for every figure when the provider records no tool calls", () => {
    const vm = toSessionAuditViewModel(sessionAudit({ toolCallsUnavailableReason: "Agent Host does not record tool calls", totals: none, failureRate: null, byTool: [], byFailureCategory: [], retries: [], perTurn: [] }));
    expect(vm.unavailableReason).toBe("Agent Host does not record tool calls");
    expect(vm.tiles.toolCalls).toMatchObject({ text: "Unknown", known: false });
    expect(vm.tiles.failed.text).toBe("Unknown");
    expect(vm.tiles.unknown.text).toBe("Unknown");
  });

  it("omits the breakdown parts that are zero", () => {
    const vm = toSessionAuditViewModel(sessionAudit({ totals: { toolCalls: 10, succeeded: 7, failed: 3, interrupted: 0, denied: 0, unknown: 0 }, failureRate: 0.3, outcomeCoverage: { known: 10, unknown: 0, unknownReasons: [] } }));
    expect(vm.tiles.failed.note).toBe("error 3");
  });
});

describe("toSessionAuditViewModel categories and recovery cost", () => {
  it("lists failure categories by count, with a bar sized against the largest", () => {
    const { categories } = toSessionAuditViewModel(sessionAudit());
    expect(categories.title).toBe("14 failed calls by category");
    expect(categories.rows.map((row) => [row.label, row.count])).toEqual([
      ["test-or-build-failure", 5],
      ["command-not-found", 3],
      ["file-not-found", 2],
      ["timeout", 2],
      ["wrong-directory", 1],
      ["user-rejected", 1],
    ]);
    expect(categories.rows[0]!.fraction).toBe(1);
    expect(categories.rows[1]!.fraction).toBeCloseTo(0.6);
  });

  it("shows recovery cost in tokens, labelled as not AI Credits", () => {
    const { recovery } = toSessionAuditViewModel(sessionAudit());
    expect(recovery.unitLabel).toBe("tokens, not AI Credits");
    expect(recovery.rounds.text).toBe("12");
    expect(recovery.affectedTurns).toMatchObject({ text: "9", note: "turns 4, 7, 12, 13, 19, 22, 27, 31, 38" });
    expect(recovery.tokens.text).toBe("6,240 out · 1,284,500 in");
    expect(recovery.tokensNote).toBe("input counts uncached, cache write and cache read");
    expect(recovery.caveat).toBe("Per-round tokens are not recorded, so the cost is exact for the affected turns, not an estimate per round.");
  });

  it("keeps a long turn list short", () => {
    const affectedTurns = Array.from({ length: 20 }, (_, i) => i + 1);
    const { recovery } = toSessionAuditViewModel(sessionAudit({ failureRecoveryCost: { ...sessionAudit().failureRecoveryCost, affectedTurns } }));
    expect(recovery.affectedTurns.note).toBe("turns 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 and 8 more");
  });

  it("says Unknown for tokens that are not recorded, and why", () => {
    const base = sessionAudit().failureRecoveryCost;
    const { recovery } = toSessionAuditViewModel(sessionAudit({ failureRecoveryCost: { ...base, affectedTurnsOutputTokens: { known: false, reason: "no usage in the log" }, affectedTurnsInputTokens: { known: true, value: 900, estimated: true } } }));
    expect(recovery.tokens.text).toBe("Unknown out · 900 in");
    expect(recovery.tokens.known).toBe(false);
    expect(recovery.tokensNote).toContain("no usage in the log");
    expect(recovery.tokensNote).toContain("estimate");
  });

  it("says there is no recovery cost when nothing failed", () => {
    const { recovery } = toSessionAuditViewModel(
      sessionAudit({ byFailureCategory: [], failureRecoveryCost: { recoveryRounds: 0, affectedTurns: [], affectedTurnsOutputTokens: { known: true, value: 0 }, affectedTurnsInputTokens: { known: true, value: 0 } } }),
    );
    expect(recovery.none).toBe(true);
    expect(recovery.noneText).toBe("No failed calls, so no recovery cost.");
  });
});

describe("toSessionAuditViewModel retries and tools", () => {
  it("lists retried commands with their result, as logged text", () => {
    const { retries } = toSessionAuditViewModel(sessionAudit());
    expect(retries).toEqual([
      { command: "npm test -- exporter", triesText: "4", resultText: "succeeded on try 4", succeeded: true },
      { command: "docker compose up -d db", triesText: "2", resultText: "never succeeded", succeeded: false },
    ]);
  });

  it("lists tools by calls, most first", () => {
    const { byTool } = toSessionAuditViewModel(sessionAudit());
    expect(byTool.map((row) => [row.name, row.callsText, row.failedText])).toEqual([
      ["run_in_terminal", "64", "9"],
      ["read_file", "31", "2"],
      ["apply_patch", "14", "1"],
      ["grep_search", "9", "2"],
    ]);
  });
});

describe("toAuditRollupViewModel", () => {
  it("writes the period, the session count and the tiles", () => {
    const vm = toAuditRollupViewModel(auditRollup());
    expect(vm.periodText).toBe("Oct 19 – Nov 1");
    expect(vm.sessionsText).toBe("20 sessions");
    expect(vm.tiles.toolCalls).toMatchObject({ text: "2,147", note: "in 20 sessions with known tool calls" });
    expect(vm.tiles.failed).toMatchObject({ text: "226", note: "error 187 · interrupted 21 · denied 18" });
    expect(vm.tiles.failureRate).toMatchObject({ text: "10.8 %", note: "of 2,098 calls with a known outcome" });
  });

  it("names the sessions left out for unrecorded tool calls, never counting them as 0", () => {
    const vm = toAuditRollupViewModel(auditRollup({ toolCallsUnavailableReason: "Agent Host does not record tool calls" }));
    expect(vm.leftOut).toEqual({ text: "3 sessions", note: "tool calls not recorded (Agent Host does not record tool calls); not counted as 0" });
    expect(toAuditRollupViewModel(auditRollup({ sessionsWithUnknownToolCalls: 1 })).leftOut?.text).toBe("1 session");
    expect(toAuditRollupViewModel(auditRollup({ sessionsWithUnknownToolCalls: 0 })).leftOut).toBeUndefined();
  });

  it("counts failed calls per day and leaves a day with no known outcome as a gap", () => {
    const { daily } = toAuditRollupViewModel(auditRollup());
    expect(daily.points.map((day) => [day.label, day.value, day.text])).toEqual([
      ["Oct 19", 9, "9"],
      ["Oct 20", null, "Unknown"],
      ["Oct 21", 18, "18"],
    ]);
    expect(daily.maxValue).toBe(18);
  });

  it("ranks categories and failing commands, with the command as logged text", () => {
    const vm = toAuditRollupViewModel(auditRollup());
    expect(vm.categories.title).toBe("149 failed calls by category");
    expect(vm.categories.rows[0]).toMatchObject({ label: "test-or-build-failure", count: 88 });
    expect(vm.topCommands).toEqual([
      { command: "npm test", category: "test-or-build-failure", failsText: "41", sessionsText: "9" },
      { command: "python3 scripts/seed.py", failsText: "12", sessionsText: "3" },
    ]);
  });

  it("lists sessions by failed calls, display only, with the unknown count", () => {
    const { sessions } = toAuditRollupViewModel(auditRollup());
    expect(sessions.rows.map((row) => [row.title, row.callsText, row.failedText, row.unknownText])).toEqual([
      ["Fix flaky invoice test", "203", "31", "0"],
      ["Add retry to export job", "118", "14", "7"],
    ]);
    expect(sessions.shownNote).toBeUndefined();
  });

  it("notes when only the top sessions are shown", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ sessionId: `s${i}`, title: `Session ${i}`, toolCalls: 10, failed: i, unknown: 0 }));
    const { sessions } = toAuditRollupViewModel(auditRollup({ sessions: many }));
    expect(sessions.rows).toHaveLength(10);
    expect(sessions.shownNote).toBe("10 of 14 shown");
  });

  it("reads Unknown when every session is left out", () => {
    const vm = toAuditRollupViewModel(
      auditRollup({ sessionCount: 0, sessionsWithUnknownToolCalls: 4, toolCallsUnavailableReason: "not recorded", totals: none, failureRate: null, byFailureCategory: [], topFailingCommands: [], daily: [], sessions: [], byTool: [], outcomeCoverage: { known: 0, unknown: 0, unknownReasons: [] } }),
    );
    expect(vm.tiles.toolCalls).toMatchObject({ text: "Unknown", known: false });
    expect(vm.tiles.failureRate).toMatchObject({ text: "Unknown", known: false });
    expect(vm.leftOut?.text).toBe("4 sessions");
  });
});
