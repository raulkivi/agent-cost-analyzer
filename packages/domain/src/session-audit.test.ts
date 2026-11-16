// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { auditRollupSchema, sessionAuditSchema } from "./session-audit.js";

const totals = { toolCalls: 3, succeeded: 1, failed: 1, interrupted: 1, denied: 0, unknown: 0 };

function sampleAudit() {
  return {
    sessionId: "s1",
    providerId: "claude-code",
    title: "Bash failures",
    totals,
    failureRate: 2 / 3,
    byTool: [{ name: "Bash", calls: 3, failed: 2, totalDurationMs: 300 }],
    byShellProgram: [{ program: "npm", calls: 3, failed: 2 }],
    byFailureCategory: [{ category: "timeout", count: 1 }],
    perTurn: [{ turnIndex: 0, succeeded: 1, failed: 1, interrupted: 1, denied: 0, unknown: 0 }],
    calls: [{ turnIndex: 0, call: { name: "Bash", argsSummary: "npm test", outcome: { status: "success" } } }],
    retries: [{ command: "npm test", attempts: 2, eventuallySucceeded: true, turnIndexes: [0] }],
    failureRecoveryCost: {
      recoveryRounds: 1,
      affectedTurns: [0],
      affectedTurnsOutputTokens: { known: true, value: 40 },
      affectedTurnsInputTokens: { known: false, reason: "no usage" },
    },
    outcomeCoverage: { known: 3, unknown: 0, unknownReasons: [] },
  };
}

describe("sessionAuditSchema", () => {
  it("accepts a full session audit", () => {
    expect(sessionAuditSchema.parse(sampleAudit())).toEqual(sampleAudit());
  });

  it("accepts a null failure rate when no outcome is known", () => {
    expect(sessionAuditSchema.parse({ ...sampleAudit(), failureRate: null }).failureRate).toBeNull();
  });

  it("carries the reason tool calls are unavailable, so an empty list isn't read as zero calls", () => {
    const audit = { ...sampleAudit(), toolCallsUnavailableReason: "not read yet" };
    expect(sessionAuditSchema.parse(audit).toolCallsUnavailableReason).toBe("not read yet");
  });

  it("rejects a failure rate outside 0..1", () => {
    expect(() => sessionAuditSchema.parse({ ...sampleAudit(), failureRate: 1.5 })).toThrow();
  });
});

function sampleRollup() {
  return {
      providerId: "claude-code",
      since: "2026-09-01",
      sessionCount: 2,
      sessionsWithUnknownToolCalls: 1,
      sessionsWithUnreadSubagentRuns: 0,
      toolCallsUnavailableReason: "not read yet",
      totals,
      failureRate: 0.5,
      byTool: [],
      byShellProgram: [],
      byFailureCategory: [{ category: "command-not-found", count: 2 }],
      topFailingCommands: [
        { command: "foo --version", program: "foo", failures: 2, sessions: 1, failureCategory: "command-not-found" },
      ],
      daily: [{ date: "2026-09-27", toolCalls: 3, succeeded: 1, failed: 1, interrupted: 1, denied: 0, unknown: 0 }],
      sessions: [{ sessionId: "s1", title: "t", startedAt: "2026-09-27T12:00:00Z", toolCalls: 3, failed: 2, unknown: 0 }],
      outcomeCoverage: { known: 3, unknown: 0, unknownReasons: [] },
    };
}

describe("auditRollupSchema", () => {
  it("accepts a cross-session rollup", () => {
    const rollup = sampleRollup();
    expect(auditRollupSchema.parse(rollup)).toEqual(rollup);
  });

  it("treats a rollup without the unknown-tool-calls count as having none", () => {
    const { sessionsWithUnknownToolCalls: _omitted, ...rest } = sampleRollup();
    void _omitted;
    expect(auditRollupSchema.parse(rest).sessionsWithUnknownToolCalls).toBe(0);
  });
});

describe("subagent fields of the audit (step 10.20)", () => {
  const run = {
    runId: "child-1",
    label: "runSubagent-Explore",
    depth: 1,
    turnIndex: 0,
    totals,
    failureRate: 2 / 3,
  };
  const byOrigin = { main: totals, subagents: { ...totals, runs: 1 } };

  it("accepts byOrigin and subagentRuns, both optional", () => {
    const audit = { ...sampleAudit(), byOrigin, subagentRuns: [run] };
    expect(sessionAuditSchema.parse(audit)).toEqual(audit);
    expect(sessionAuditSchema.parse(sampleAudit()).byOrigin).toBeUndefined();
  });

  it("accepts a run with known totals and a flag (D12)", () => {
    const flagged = { ...run, unreadReason: "start call missing from the log" };
    const audit = { ...sampleAudit(), subagentRuns: [flagged] };
    expect(sessionAuditSchema.parse(audit).subagentRuns?.[0]).toEqual(flagged);
  });

  it("accepts a run placed by time (10.19 D5) and treats the flag as optional", () => {
    const byTime = { ...run, matchedByTime: true };
    expect(sessionAuditSchema.parse({ ...sampleAudit(), subagentRuns: [byTime] }).subagentRuns?.[0]?.matchedByTime).toBe(true);
    expect(sessionAuditSchema.parse({ ...sampleAudit(), subagentRuns: [run] }).subagentRuns?.[0]?.matchedByTime).toBeUndefined();
    expect(sessionAuditSchema.safeParse({ ...sampleAudit(), subagentRuns: [{ ...run, matchedByTime: "yes" }] }).success).toBe(false);
  });

  it("accepts an unread run with null totals and a reason (D12)", () => {
    const unread = { ...run, totals: null, failureRate: null, unreadReason: "log not found" };
    expect(sessionAuditSchema.parse({ ...sampleAudit(), subagentRuns: [unread] }).subagentRuns?.[0]?.totals).toBeNull();
  });

  it("rejects null totals without a reason (D12: unread is never silent)", () => {
    const unread = { ...run, totals: null, failureRate: null };
    expect(sessionAuditSchema.safeParse({ ...sampleAudit(), subagentRuns: [unread] }).success).toBe(false);
  });

  it("rejects a hostile run id or label", () => {
    expect(sessionAuditSchema.safeParse({ ...sampleAudit(), subagentRuns: [{ ...run, runId: "../x" }] }).success).toBe(false);
    expect(sessionAuditSchema.safeParse({ ...sampleAudit(), subagentRuns: [{ ...run, label: "<b>" }] }).success).toBe(false);
  });

  it("rejects a run deeper than the bound", () => {
    expect(sessionAuditSchema.safeParse({ ...sampleAudit(), subagentRuns: [{ ...run, depth: 9 }] }).success).toBe(false);
  });

  it("carries byOrigin and the unread-run count on the rollup, defaulting the count to 0", () => {
    const rollup = { ...sampleRollup(), byOrigin, sessionsWithUnreadSubagentRuns: 2 };
    expect(auditRollupSchema.parse(rollup)).toEqual(rollup);
    expect(auditRollupSchema.parse(sampleRollup()).sessionsWithUnreadSubagentRuns).toBe(0);
  });
});
