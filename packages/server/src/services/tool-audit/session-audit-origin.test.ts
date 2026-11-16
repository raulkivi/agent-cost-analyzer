// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  sessionAuditSchema,
  unavailableTokenCount,
  type Session,
  type SubagentRunGap,
  type SubagentRunUsage,
  type ToolCallOrigin,
  type ToolCallRecord,
  type Turn,
} from "@agent-cost-analyzer/domain";
import { buildSessionAudit } from "./session-audit-builder.js";

// Synthetic fixtures only (step 10.20 ST9): origins as ST3 defined them.
const known = (value: number) => ({ known: true as const, value });

const usage = () => ({
  uncachedInput: known(100),
  cacheWrite: known(0),
  cacheRead: known(0),
  tool: unavailableTokenCount("n/a"),
  vision: unavailableTokenCount("n/a"),
  reasoning: unavailableTokenCount("n/a"),
  output: known(10),
  costAiCredits: unavailableTokenCount("n/a"),
  model: "m",
});

function runUsage(id: string, label: string, parentRunId?: string): SubagentRunUsage {
  return {
    id,
    label,
    model: "m",
    roundsCount: 1,
    uncachedInput: known(1),
    cacheWrite: known(0),
    cacheRead: known(0),
    reasoning: known(0),
    output: known(1),
    costAiCredits: known(0),
    ...(parentRunId ? { parentRunId } : {}),
    attribution: "child-session-ref",
  };
}

function turn(index: number, toolCalls: ToolCallRecord[], extra: Partial<Turn> = {}, runs: SubagentRunUsage[] = []): Turn {
  const base = usage();
  return {
    index,
    userMessage: "",
    assistantResponse: "",
    toolCalls,
    usage: runs.length ? { ...base, subagents: runs, ownUsage: { ...base } as never } : base,
    explanation: "",
    ...extra,
  };
}

function session(turns: Turn[]): Session {
  return {
    id: "s1",
    mode: "analyze",
    providerId: "vscode-copilot",
    title: "t",
    model: "m",
    turns,
    turnCount: turns.length,
    costAiCredits: unavailableTokenCount("n/a"),
    usageDataAvailable: true,
    startedAt: "2026-09-27T12:00:00.000Z",
  };
}

const run = (runId: string, label = "runSubagent-Explore", depth = 1, parentRunId?: string): ToolCallOrigin => ({
  kind: "subagent",
  runId,
  label,
  depth,
  ...(parentRunId ? { parentRunId } : {}),
});

function shell(command: string, status: "success" | "error", origin?: ToolCallOrigin, roundIndex = 0): ToolCallRecord {
  return {
    name: "Bash",
    kind: "shell",
    argsSummary: command,
    shell: { command, program: command.split(" ")[0] },
    outcome: status === "success" ? { status } : { status, failureCategory: "command-not-found" },
    roundIndex,
    ...(origin ? { origin } : {}),
  };
}

describe("buildSessionAudit: byOrigin", () => {
  it("is absent for a session with no subagent run, so old output is unchanged", () => {
    const audit = buildSessionAudit(session([turn(0, [shell("a", "success"), shell("b", "error")])]));

    expect(audit.byOrigin).toBeUndefined();
    expect(audit.subagentRuns).toBeUndefined();
  });

  it("splits main and subagent totals; the all-calls totals keep meaning main plus every run", () => {
    const audit = buildSessionAudit(
      session([
        turn(0, [
          shell("a", "success"),
          shell("b", "error", run("r1")),
          shell("c", "success", run("r1")),
          shell("d", "success", run("r2", "searchSubagent")),
        ]),
      ]),
    );

    expect(audit.totals.toolCalls).toBe(4);
    expect(audit.byOrigin?.main).toMatchObject({ toolCalls: 1, succeeded: 1 });
    expect(audit.byOrigin?.subagents).toMatchObject({ toolCalls: 3, succeeded: 2, failed: 1, runs: 2 });
    expect(() => sessionAuditSchema.parse(audit)).not.toThrow();
  });

  it("counts an unread run in byOrigin.subagents.runs but adds no calls for it", () => {
    const audit = buildSessionAudit(
      session([turn(0, [shell("a", "success")], {}, [runUsage("lost", "runSubagent-Plan")])]),
    );

    expect(audit.byOrigin?.subagents).toMatchObject({ toolCalls: 0, runs: 1 });
    expect(audit.byOrigin?.main.toolCalls).toBe(1);
  });
});

describe("buildSessionAudit: a run the reader read in full that made no call", () => {
  const noCalls = (extra: Partial<Turn>) =>
    buildSessionAudit(session([turn(0, [shell("a", "success")], extra, [runUsage("quiet", "searchSubagent")])])).subagentRuns?.[0];

  it("is known with 0 calls and no failure rate when the turn lists it as read", () => {
    const row = noCalls({ subagentRunsRead: ["quiet"] });

    expect(row).toMatchObject({ runId: "quiet", failureRate: null });
    expect(row?.totals).toMatchObject({ toolCalls: 0, succeeded: 0, failed: 0 });
    expect(row?.unreadReason).toBeUndefined();
  });

  it("stays unread, never 0, when nothing says it was read", () => {
    expect(noCalls({})?.totals).toBeNull();
    expect(noCalls({ subagentRunsRead: ["other"] })?.totals).toBeNull();
  });

  it("a gap wins over the read marker", () => {
    const row = noCalls({
      subagentRunsRead: ["quiet"],
      subagentRunGaps: [{ runId: "quiet", label: "searchSubagent", depth: 1, reason: "why" }],
    });

    expect(row?.totals).toBeNull();
    expect(row?.unreadReason).toBe("why");
  });

  it("counts toward byOrigin.subagents.runs with no calls added", () => {
    const audit = buildSessionAudit(
      session([turn(0, [], { subagentRunsRead: ["quiet"] }, [runUsage("quiet", "searchSubagent")])]),
    );

    expect(audit.byOrigin?.subagents).toMatchObject({ toolCalls: 0, runs: 1 });
    expect(() => sessionAuditSchema.parse(audit)).not.toThrow();
  });
});

describe("buildSessionAudit: subagentRuns", () => {
  it("lists one row per read run with its own totals, failure rate, turn and nesting", () => {
    const audit = buildSessionAudit(
      session([
        turn(0, [shell("a", "success")]),
        turn(1, [
          shell("b", "error", run("r1")),
          shell("c", "success", run("r1")),
          shell("d", "success", run("r2", "task-Fix", 2, "r1")),
        ]),
      ]),
    );

    expect(audit.subagentRuns).toEqual([
      {
        runId: "r1",
        label: "runSubagent-Explore",
        depth: 1,
        turnIndex: 1,
        totals: { toolCalls: 2, succeeded: 1, failed: 1, interrupted: 0, denied: 0, unknown: 0, canceled: 0 },
        failureRate: 0.5,
      },
      {
        runId: "r2",
        label: "task-Fix",
        depth: 2,
        parentRunId: "r1",
        turnIndex: 1,
        totals: { toolCalls: 1, succeeded: 1, failed: 0, interrupted: 0, denied: 0, unknown: 0, canceled: 0 },
        failureRate: 0,
      },
    ]);
  });

  it("lists a run the cost side knows but that has no calls as unread: totals null, never 0, with a reason", () => {
    const audit = buildSessionAudit(session([turn(2, [], {}, [runUsage("lost", "runSubagent-Plan")])]));

    const [row] = audit.subagentRuns ?? [];
    expect(row).toMatchObject({ runId: "lost", label: "runSubagent-Plan", depth: 1, turnIndex: 2, totals: null, failureRate: null });
    expect(row.unreadReason).toMatch(/runSubagent-Plan/);
    expect(() => sessionAuditSchema.parse(audit)).not.toThrow();
  });

  it("gives an unread run the reason its reader stated, and the nesting the gap carries", () => {
    const gap: SubagentRunGap = { runId: "lost", label: "searchSubagent", depth: 2, parentRunId: "p", reason: "nested subagents are not read" };
    const audit = buildSessionAudit(session([turn(0, [], { subagentRunGaps: [gap] }, [runUsage("lost", "searchSubagent", "p")])]));

    expect(audit.subagentRuns).toHaveLength(1);
    expect(audit.subagentRuns?.[0]).toMatchObject({ runId: "lost", depth: 2, parentRunId: "p", totals: null, unreadReason: gap.reason });
  });

  it("lists a gap with no usage entry (a subagent tool that writes no log) as an unread run", () => {
    const gap: SubagentRunGap = { runId: "call_9", label: "runSubagent-explore", depth: 1, reason: "this subagent tool writes no log the analyzer reads" };
    const audit = buildSessionAudit(session([turn(0, [], { subagentRunGaps: [gap] })]));

    expect(audit.subagentRuns).toEqual([
      { runId: "call_9", label: "runSubagent-explore", depth: 1, turnIndex: 0, totals: null, failureRate: null, unreadReason: gap.reason },
    ]);
  });

  it("keeps known totals and adds the flag when a gap accompanies a run with calls (D12)", () => {
    const gap: SubagentRunGap = { runId: "r1", label: "task-Fix", depth: 1, reason: "the call that started this subagent run is not in the log" };
    const audit = buildSessionAudit(
      session([turn(0, [shell("a", "error", run("r1", "task-Fix"))], { subagentRunGaps: [gap] })]),
    );

    expect(audit.subagentRuns?.[0]).toMatchObject({ totals: { toolCalls: 1, failed: 1 }, failureRate: 1, unreadReason: gap.reason });
    expect(audit.byOrigin?.subagents.toolCalls).toBe(1);
  });

  it("does not list a run twice when calls, usage and a gap all name it", () => {
    const gap: SubagentRunGap = { runId: "r1", label: "runSubagent-Explore", depth: 1, reason: "flag" };
    const audit = buildSessionAudit(
      session([turn(0, [shell("a", "success", run("r1"))], { subagentRunGaps: [gap] }, [runUsage("r1", "runSubagent-Explore")])]),
    );

    expect(audit.subagentRuns).toHaveLength(1);
  });

  it("adds each unread run's reason to outcomeCoverage.unknownReasons, and not a flag on a read run", () => {
    const lost: SubagentRunGap = { runId: "lost", label: "searchSubagent", depth: 1, reason: "too many subagent logs to read" };
    const flag: SubagentRunGap = { runId: "r1", label: "runSubagent-Explore", depth: 1, reason: "start call missing" };
    const audit = buildSessionAudit(
      session([turn(0, [shell("a", "success", run("r1"))], { subagentRunGaps: [lost, flag] })]),
    );

    expect(audit.outcomeCoverage.unknownReasons).toContain("too many subagent logs to read");
    expect(audit.outcomeCoverage.unknownReasons).not.toContain("start call missing");
  });
});

describe("buildSessionAudit: retries stay within one origin (D6)", () => {
  it("does not join a main failure with a subagent's later success of the same command", () => {
    const audit = buildSessionAudit(
      session([turn(0, [shell("npm test", "error"), shell("npm test", "success", run("r1"))])]),
    );

    expect(audit.retries).toEqual([]);
  });

  it("does not join two different runs' attempts of the same command", () => {
    const audit = buildSessionAudit(
      session([turn(0, [shell("npm test", "error", run("r1")), shell("npm test", "success", run("r2"))])]),
    );

    expect(audit.retries).toEqual([]);
  });

  it("still finds a retry inside one run, across that run's turn", () => {
    const audit = buildSessionAudit(
      session([turn(0, [shell("npm test", "error", run("r1")), shell("npm test", "success", run("r1"))])]),
    );

    expect(audit.retries).toEqual([{ command: "npm test", attempts: 2, eventuallySucceeded: true, turnIndexes: [0] }]);
  });

  it("keeps main-agent retries as before when a run issued the same command in between", () => {
    const audit = buildSessionAudit(
      session([
        turn(0, [shell("npm test", "error"), shell("npm test", "error", run("r1")), shell("npm test", "success")]),
      ]),
    );

    expect(audit.retries).toEqual([{ command: "npm test", attempts: 2, eventuallySucceeded: true, turnIndexes: [0] }]);
  });
});

describe("buildSessionAudit: failureRecoveryCost counts main-agent rounds only (D6)", () => {
  it("ignores a turn whose only failures are a subagent's", () => {
    const audit = buildSessionAudit(session([turn(0, [shell("a", "error", run("r1"))]), turn(1, [shell("b", "error")])]));

    expect(audit.failureRecoveryCost.affectedTurns).toEqual([1]);
    expect(audit.failureRecoveryCost.recoveryRounds).toBe(1);
  });

  it("does not let a subagent's round index collide with a main round in the same turn", () => {
    const audit = buildSessionAudit(
      session([turn(0, [shell("a", "error", undefined, 3), shell("b", "error", run("r1"), 4), shell("c", "error", run("r1"), 5)])]),
    );

    expect(audit.failureRecoveryCost.recoveryRounds).toBe(1);
  });
});
