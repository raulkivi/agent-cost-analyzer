// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { auditRollupSchema, unavailableTokenCount, type SessionAudit, type ToolCallRecord } from "@agent-cost-analyzer/domain";
import { AGENT_HOST_TOOL_CALLS_UNAVAILABLE_REASON } from "./tool-calls-availability.js";
import { buildAuditRollup } from "./audit-rollup-builder.js";

function call(command: string, status: "success" | "error", startedAt: string, category?: "command-not-found"): ToolCallRecord {
  return {
    name: "Bash",
    kind: "shell",
    argsSummary: command,
    shell: { command, program: command.split(" ")[0] },
    startedAt,
    outcome: status === "success" ? { status } : { status, failureCategory: category ?? "command-not-found" },
  };
}

function audit(sessionId: string, calls: ToolCallRecord[], unknown = 0): SessionAudit {
  const failed = calls.filter((c) => c.outcome?.status === "error").length;
  return {
    sessionId,
    title: `Session ${sessionId}`,
    startedAt: "2026-09-26T10:00:00.000Z",
    totals: { toolCalls: calls.length + unknown, succeeded: calls.length - failed, failed, interrupted: 0, denied: 0, unknown },
    failureRate: calls.length ? failed / calls.length : null,
    byTool: [{ name: "Bash", calls: calls.length, failed }],
    byShellProgram: [{ program: "foo", calls: failed, failed }],
    byFailureCategory: failed ? [{ category: "command-not-found", count: failed }] : [],
    perTurn: [],
    calls: calls.map((c) => ({ turnIndex: 0, call: c })),
    retries: [],
    failureRecoveryCost: {
      recoveryRounds: 0,
      affectedTurns: [],
      affectedTurnsOutputTokens: unavailableTokenCount("x"),
      affectedTurnsInputTokens: unavailableTokenCount("x"),
    },
    outcomeCoverage: { known: calls.length, unknown, unknownReasons: unknown ? ["no outcomes"] : [] },
  };
}

describe("buildAuditRollup", () => {
  const audits = [
    audit("a", [call("foo --v", "error", "2026-09-26T10:00:00Z"), call("git status", "success", "2026-09-26T11:00:00Z")]),
    audit("b", [call("foo --v", "error", "2026-09-27T09:00:00Z"), call("foo --v", "error", "2026-09-27T09:05:00Z")], 1),
  ];

  it("sums totals and recomputes the failure rate over known outcomes", () => {
    const rollup = buildAuditRollup(audits, { providerId: "claude-code" });

    expect(rollup.sessionCount).toBe(2);
    expect(rollup.totals).toEqual({ toolCalls: 5, succeeded: 1, failed: 3, interrupted: 0, denied: 0, unknown: 1, canceled: 0 });
    expect(rollup.failureRate).toBeCloseTo(3 / 4);
    expect(rollup.outcomeCoverage).toEqual({ known: 4, unknown: 1, unknownReasons: ["no outcomes"] });
    expect(() => auditRollupSchema.parse(rollup)).not.toThrow();
  });

  it("ranks the top failing commands with the number of sessions they failed in", () => {
    const rollup = buildAuditRollup(audits, {});

    expect(rollup.topFailingCommands).toEqual([
      { command: "foo --v", program: "foo", failures: 3, sessions: 2, failureCategory: "command-not-found" },
    ]);
  });

  it("buckets calls per day", () => {
    expect(buildAuditRollup(audits, {}).daily).toEqual([
      { date: "2026-09-26", toolCalls: 2, succeeded: 1, failed: 1, interrupted: 0, denied: 0, unknown: 0, canceled: 0 },
      { date: "2026-09-27", toolCalls: 2, succeeded: 0, failed: 2, interrupted: 0, denied: 0, unknown: 0, canceled: 0 },
    ]);
  });

  it("merges per-program and per-category breakdowns", () => {
    const rollup = buildAuditRollup(audits, {});
    expect(rollup.byShellProgram).toEqual([{ program: "foo", calls: 3, failed: 3 }]);
    expect(rollup.byFailureCategory).toEqual([{ category: "command-not-found", count: 3 }]);
  });

  it("summarizes each session", () => {
    expect(buildAuditRollup(audits, {}).sessions.map((s) => [s.sessionId, s.toolCalls, s.failed, s.unknown])).toEqual([
      ["a", 2, 1, 0],
      ["b", 3, 2, 1],
    ]);
  });

  it("leaves sessions whose tool calls are unknown out of the counts and reports how many", () => {
    const unknownCalls = { ...audit("ah", []), toolCallsUnavailableReason: AGENT_HOST_TOOL_CALLS_UNAVAILABLE_REASON };

    const rollup = buildAuditRollup([...audits, unknownCalls], {});

    expect(rollup.sessionCount).toBe(2);
    expect(rollup.sessions.map((s) => s.sessionId)).toEqual(["a", "b"]);
    expect(rollup.sessionsWithUnknownToolCalls).toBe(1);
    expect(rollup.toolCallsUnavailableReason).toBe(AGENT_HOST_TOOL_CALLS_UNAVAILABLE_REASON);
    expect(rollup.totals.toolCalls).toBe(5);
    expect(() => auditRollupSchema.parse(rollup)).not.toThrow();
  });

  it("reports no unknown-tool-call sessions when every session records its calls", () => {
    const rollup = buildAuditRollup(audits, {});
    expect(rollup.sessionsWithUnknownToolCalls).toBe(0);
    expect(rollup.toolCallsUnavailableReason).toBeUndefined();
  });

  it("handles no sessions", () => {
    const rollup = buildAuditRollup([], {});
    expect(rollup.failureRate).toBeNull();
    expect(rollup.sessionCount).toBe(0);
  });

  describe("subagent runs (step 10.20)", () => {
    const totalsOf = (toolCalls: number, failed = 0) => ({
      toolCalls,
      succeeded: toolCalls - failed,
      failed,
      interrupted: 0,
      denied: 0,
      unknown: 0,
    });
    const readRun = { runId: "r1", label: "searchSubagent", depth: 1, turnIndex: 0, totals: totalsOf(2, 1), failureRate: 0.5 };
    const unreadRun = {
      runId: "r2",
      label: "runSubagent-Explore",
      depth: 1,
      turnIndex: 0,
      totals: null,
      failureRate: null,
      unreadReason: "The subagent log is missing.",
    };
    const withRuns = (id: string, runs: SessionAudit["subagentRuns"], main: number, sub: number): SessionAudit => ({
      ...audit(id, []),
      totals: totalsOf(main + sub),
      byOrigin: { main: totalsOf(main), subagents: { ...totalsOf(sub), runs: runs?.length ?? 0 } },
      subagentRuns: runs,
      outcomeCoverage: {
        known: main + sub,
        unknown: 0,
        unknownReasons: runs?.flatMap((run) => (run.totals === null ? [run.unreadReason ?? ""] : [])) ?? [],
      },
    });

    it("leaves byOrigin out and counts no unread sessions when no session has a run", () => {
      const rollup = buildAuditRollup(audits, {});

      expect(rollup.byOrigin).toBeUndefined();
      expect(rollup.sessionsWithUnreadSubagentRuns).toBe(0);
    });

    it("sums byOrigin over sessions, so main plus subagents equals the totals", () => {
      const rollup = buildAuditRollup(
        [withRuns("a", [readRun], 3, 2), withRuns("b", [readRun, unreadRun], 1, 2), audit("c", [])],
        {},
      );

      expect(rollup.byOrigin?.main.toolCalls).toBe(4);
      expect(rollup.byOrigin?.subagents).toMatchObject({ toolCalls: 4, runs: 3 });
      expect(rollup.totals.toolCalls).toBe(8);
    });

    it("counts a session without runs as main-agent calls, so main plus subagents stays the totals", () => {
      const plain = audit("p", [call("ls", "success", "2026-09-26T10:00:00Z")]);
      const rollup = buildAuditRollup([withRuns("a", [readRun], 3, 2), plain], {});

      expect(rollup.byOrigin?.main.toolCalls).toBe(4);
      expect(rollup.byOrigin?.main.toolCalls).toBe(rollup.totals.toolCalls - (rollup.byOrigin?.subagents.toolCalls ?? 0));
      expect(() => auditRollupSchema.parse(rollup)).not.toThrow();
    });

    it("counts sessions with an unread run, keeps them in every count (D4) and carries their reasons", () => {
      const rollup = buildAuditRollup([withRuns("a", [readRun], 3, 2), withRuns("b", [readRun, unreadRun], 1, 2)], {});

      expect(rollup.sessionsWithUnreadSubagentRuns).toBe(1);
      expect(rollup.sessionCount).toBe(2);
      expect(rollup.sessions.map((s) => s.sessionId)).toEqual(["a", "b"]);
      expect(rollup.totals.toolCalls).toBe(8);
      expect(rollup.outcomeCoverage.unknownReasons).toContain("The subagent log is missing.");
    });

    it("counts a run flagged but with known totals as read (D12)", () => {
      const flagged = { ...readRun, unreadReason: "start call missing" };
      expect(buildAuditRollup([withRuns("a", [flagged], 1, 2)], {}).sessionsWithUnreadSubagentRuns).toBe(0);
    });

    it("does not count a session whose tool calls are unavailable", () => {
      const unavailable = { ...withRuns("x", [unreadRun], 0, 0), toolCallsUnavailableReason: AGENT_HOST_TOOL_CALLS_UNAVAILABLE_REASON };
      const rollup = buildAuditRollup([unavailable], {});

      expect(rollup.sessionsWithUnreadSubagentRuns).toBe(0);
      expect(rollup.byOrigin).toBeUndefined();
    });
  });
});
