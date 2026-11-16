// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { toAuditRollupViewModel, toSessionAuditViewModel } from "./audit.js";
import { auditRollup, sessionAudit, subagentAudit } from "./audit-fixtures.js";

// Step 10.20, ST13 (docs/plans/subagent-tool-audit.md §5.7, §6, D12, D14).

describe("toSessionAuditViewModel without subagent runs", () => {
  it("has no subagent section, no sub-line and no canceled line", () => {
    const vm = toSessionAuditViewModel(sessionAudit());
    expect(vm.subagents).toBeUndefined();
    expect(vm.tiles.toolCalls.subline).toBeUndefined();
    expect(vm.canceledText).toBeUndefined();
  });
});

describe("toSessionAuditViewModel with subagent runs", () => {
  it("adds the sub-line to the tool calls tile and keeps the all-calls figure", () => {
    const vm = toSessionAuditViewModel(subagentAudit());
    expect(vm.tiles.toolCalls.text).toBe("214");
    expect(vm.tiles.toolCalls.subline).toBe("incl. 83 calls from 3 subagent runs");
  });

  it("says how many runs were read when some are unread", () => {
    const vm = toSessionAuditViewModel(subagentAudit({ unread: true }));
    expect(vm.tiles.toolCalls.subline).toBe("incl. 83 calls from 3 of 5 subagent runs");
    expect(vm.subagents?.unreadNote).toBe("2 subagent runs not read; their calls aren't counted.");
  });

  it("names unread runs without a count when none was read", () => {
    const audit = subagentAudit({ unread: true });
    audit.subagentRuns = audit.subagentRuns!.map((run) => ({ ...run, totals: null, failureRate: null, unreadReason: "The subagent log is missing." }));
    audit.byOrigin!.subagents = { toolCalls: 0, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 0, runs: 5 };
    const vm = toSessionAuditViewModel(audit);
    expect(vm.tiles.toolCalls.subline).toBe("no subagent run was read (5 runs)");
    const subagentsScope = toSessionAuditViewModel(audit, "subagents");
    expect(subagentsScope.tiles.toolCalls.text).toBe("Unknown");
    expect(subagentsScope.tiles.failureRate.text).toBe("Unknown");
  });

  it("offers All, Main agent and Subagents, with the chosen one selected", () => {
    expect(toSessionAuditViewModel(subagentAudit(), "main").subagents?.scopes).toEqual([
      { value: "all", label: "All", selected: false },
      { value: "main", label: "Main agent", selected: true },
      { value: "subagents", label: "Subagents", selected: false },
    ]);
  });

  it("splits the calls by agent for the bar", () => {
    const split = toSessionAuditViewModel(subagentAudit()).subagents!.split;
    expect(split.main).toMatchObject({ label: "Main agent", callsText: "131", shareText: "61.2 %" });
    expect(split.subagents).toMatchObject({ label: "Subagent runs", callsText: "83" });
    expect(split.main.fraction + split.subagents.fraction).toBeCloseTo(1, 5);
  });

  it("recomputes the tiles for the Main agent and Subagents filters from byOrigin", () => {
    const main = toSessionAuditViewModel(subagentAudit(), "main");
    expect(main.tiles.toolCalls).toMatchObject({ text: "131", note: "main agent only" });
    expect(main.tiles.failed.text).toBe("11");
    expect(main.tiles.failureRate.text).toBe("8.7 %");
    const sub = toSessionAuditViewModel(subagentAudit(), "subagents");
    expect(sub.tiles.toolCalls).toMatchObject({ text: "83", note: "read subagent runs only" });
    expect(sub.tiles.failed.text).toBe("9");
    expect(sub.tiles.unknown.text).toBe("1");
  });

  it("says which sections still count every agent when a filter is on", () => {
    expect(toSessionAuditViewModel(subagentAudit()).scopeNote).toBeUndefined();
    expect(toSessionAuditViewModel(subagentAudit(), "main").scopeNote).toBe("Failure categories, recovery cost, retries and tools count all agents.");
  });

  it("lists known runs with label, turn, calls, failed, unknown and rate", () => {
    const [explore] = toSessionAuditViewModel(subagentAudit()).subagents!.runs;
    expect(explore).toMatchObject({ kind: "known", label: "Agent-Explore", turnText: "turn 3", callsText: "41", failedText: "4", unknownText: "1", rateText: "10.0 %", figuresText: "41 calls · 4 failed · 1 unknown · 10.0 %" });
    expect(explore!.reason).toBeUndefined();
  });

  it("marks a nested run with its depth and parent", () => {
    const runs = toSessionAuditViewModel(subagentAudit({ nested: true })).subagents!.runs;
    const nested = runs.find((run) => run.label === "search_code_subagent");
    expect(nested?.depthText).toBe("depth 2 · in task-Planner");
  });

  it("shows an unread run with its reason and Unknown, never 0", () => {
    const runs = toSessionAuditViewModel(subagentAudit({ unread: true })).subagents!.runs;
    const unread = runs.find((run) => run.kind === "unread")!;
    expect(unread).toMatchObject({ callsText: "Unknown", failedText: "Unknown", unknownText: "Unknown", rateText: "Unknown" });
    expect(unread.reason).toMatch(/missing/);
  });

  it("flags a run with known totals and a reason, keeping the totals (D12)", () => {
    const runs = toSessionAuditViewModel(subagentAudit({ flagged: true })).subagents!.runs;
    const flagged = runs.find((run) => run.kind === "flagged")!;
    expect(flagged.callsText).toBe("22");
    expect(flagged.reason).toBe("The call that started this run is missing from the log.");
  });

  it("says a run was placed by time, and leaves the others unmarked", () => {
    const runs = toSessionAuditViewModel(subagentAudit({ byTime: true })).subagents!.runs;
    expect(runs.map((run) => run.matchedByTime)).toEqual([undefined, undefined, true]);
    expect(toSessionAuditViewModel(subagentAudit()).subagents!.runs.every((run) => run.matchedByTime === undefined)).toBe(true);
  });

  it("marks an unread run placed by time too", () => {
    const audit = subagentAudit({ unread: true });
    audit.subagentRuns = audit.subagentRuns!.map((run) => (run.runId === "run-review" ? { ...run, matchedByTime: true } : run));
    const unread = toSessionAuditViewModel(audit).subagents!.runs.find((run) => run.kind === "unread" && run.label === "runSubagent-Review")!;
    expect(unread.matchedByTime).toBe(true);
  });

  it("states canceled calls apart from failures (D14)", () => {
    const audit = subagentAudit();
    audit.totals = { ...audit.totals, canceled: 3 };
    audit.byOrigin!.main = { ...audit.byOrigin!.main, canceled: 3 };
    const vm = toSessionAuditViewModel(audit);
    expect(vm.canceledText).toBe("3 calls canceled by the user: not counted as failures or unknown.");
    expect(toSessionAuditViewModel(audit, "subagents").canceledText).toBeUndefined();
    expect(toSessionAuditViewModel(audit, "main").canceledText).toBe("3 calls canceled by the user: not counted as failures or unknown.");
  });

  it("uses singular wording for one canceled call and one unread run", () => {
    const audit = subagentAudit({ unread: true });
    audit.subagentRuns = audit.subagentRuns!.slice(0, 4);
    audit.totals = { ...audit.totals, canceled: 1 };
    const vm = toSessionAuditViewModel(audit);
    expect(vm.canceledText).toBe("1 call canceled by the user: not counted as failures or unknown.");
    expect(vm.subagents?.unreadNote).toBe("1 subagent run not read; its calls aren't counted.");
  });
});

describe("toAuditRollupViewModel with subagent runs", () => {
  it("adds a sub-line and the sessions with unread runs", () => {
    const vm = toAuditRollupViewModel({
      ...auditRollup(),
      byOrigin: {
        main: { toolCalls: 1800, succeeded: 1600, failed: 150, interrupted: 20, denied: 10, unknown: 20 },
        subagents: { toolCalls: 347, succeeded: 272, failed: 37, interrupted: 1, denied: 8, unknown: 29, runs: 22 },
      },
      sessionsWithUnreadSubagentRuns: 2,
    });
    expect(vm.tiles.toolCalls.subline).toBe("incl. 347 calls from 22 subagent runs");
    expect(vm.unreadNote).toBe("2 sessions have subagent runs that were not read; those calls aren't counted.");
  });

  it("has neither without byOrigin", () => {
    const vm = toAuditRollupViewModel(auditRollup());
    expect(vm.tiles.toolCalls.subline).toBeUndefined();
    expect(vm.unreadNote).toBeUndefined();
  });
});
