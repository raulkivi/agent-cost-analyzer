// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ToolCallRecord } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import type { AttributedRun } from "./attributed-run-ledger.js";
import {
  SUBAGENT_LOG_MISSING_REASON,
  SUBAGENT_LOG_NOT_REGULAR_FILE_REASON,
  SUBAGENT_LOGS_TOO_MANY_REASON,
  SUBAGENT_RUN_UNPLACEABLE_REASON,
} from "./subagent-attribution.js";
import {
  missingSubagentLogReason,
  NESTED_SUBAGENT_NOT_READ_REASON,
  TOO_MANY_SUBAGENT_LOGS_REASON,
  UNLOGGED_SUBAGENT_TOOL_REASON,
} from "./subagent-tool-call-reasons.js";
import { planSubagentRuns } from "./subagent-run-plan.js";

const T0 = 1_791_000_000_000;

function call(id: string | undefined, name: string, startOffset = 0, durationMs = 100): ToolCallRecord {
  return {
    ...(id === undefined ? {} : { id }),
    name,
    kind: name.toLowerCase().includes("subagent") ? "subagent" : "file-read",
    argsSummary: "",
    startedAt: new Date(T0 + startOffset).toISOString(),
    durationMs,
  };
}

function run(overrides: Partial<AttributedRun> = {}): AttributedRun {
  return {
    logTurn: 0,
    runId: "call_run1",
    label: "runSubagent-Explore",
    attribution: "child-session-ref",
    refTs: T0 + 10,
    parentSpanId: "span-run-call",
    log: { status: "read", childLogFile: "runSubagent-Explore-call_run1.jsonl", nestedRefs: [] },
    ...overrides,
  };
}

describe("planSubagentRuns", () => {
  it("a ref that names its call: the run's startedByCallId is that span, depth 1", () => {
    const plan = planSubagentRuns({ runs: [run()], unplaced: [] }, [[call("span-run-call", "runSubagent")]]);

    expect(plan.runsByTurn.get(0)).toEqual([
      {
        runId: "call_run1",
        label: "runSubagent-Explore",
        depth: 1,
        startedByCallId: "span-run-call",
        log: { status: "read", childLogFile: "runSubagent-Explore-call_run1.jsonl" },
      },
    ]);
    expect(plan.unread).toEqual([]);
  });

  it("a ref with no parentSpanId inside exactly one subagent call's window is that call's run (plan §14.1)", () => {
    const plan = planSubagentRuns(
      { runs: [run({ parentSpanId: null, refTs: T0 + 2, label: "searchSubagent" })], unplaced: [] },
      [[call("span-explore-1", "explore_subagent", 0, 6000)]],
    );

    expect(plan.runsByTurn.get(0)?.[0]).toMatchObject({ startedByCallId: "span-explore-1" });
    expect(plan.unread).toEqual([]);
  });

  it("a ref outside every window, or inside two windows, names no call", () => {
    const outside = planSubagentRuns(
      { runs: [run({ parentSpanId: null, refTs: T0 + 9000 })], unplaced: [] },
      [[call("span-a", "explore_subagent", 0, 100)]],
    );
    const ambiguous = planSubagentRuns(
      { runs: [run({ parentSpanId: null, refTs: T0 + 50 })], unplaced: [] },
      [[call("span-a", "explore_subagent", 0, 100), call("span-b", "explore_subagent", 10, 100)]],
    );

    expect(outside.runsByTurn.get(0)?.[0]).not.toHaveProperty("startedByCallId");
    expect(ambiguous.runsByTurn.get(0)?.[0]).not.toHaveProperty("startedByCallId");
  });

  it("an orphan has no ref, so it names no call", () => {
    const plan = planSubagentRuns(
      { runs: [run({ attribution: "timestamp", parentSpanId: null, refTs: null })], unplaced: [] },
      [[call("span-a", "explore_subagent", 0, 100)]],
    );

    expect(plan.runsByTurn.get(0)?.[0]).not.toHaveProperty("startedByCallId");
  });

  it("a parentSpanId that is not a valid call id is not carried", () => {
    const plan = planSubagentRuns({ runs: [run({ parentSpanId: "bad id with spaces" })], unplaced: [] }, [[]]);

    expect(plan.runsByTurn.get(0)?.[0]).not.toHaveProperty("startedByCallId");
  });

  it("a subagent-kind main call no run claims is an unread run (D5)", () => {
    const plan = planSubagentRuns({ runs: [], unplaced: [] }, [[call("span-explore-2", "explore_subagent")]]);

    expect(plan.unread).toEqual([
      {
        logTurn: 0,
        runId: "span-explore-2",
        label: "searchSubagent",
        depth: 1,
        reason: UNLOGGED_SUBAGENT_TOOL_REASON,
      },
    ]);
  });

  it("a call a run claimed is not also an unread run", () => {
    const plan = planSubagentRuns({ runs: [run()], unplaced: [] }, [[call("span-run-call", "runSubagent")]]);

    expect(plan.unread).toEqual([]);
  });

  it("a main call that is not a subagent tool is never an unread run", () => {
    const plan = planSubagentRuns({ runs: [], unplaced: [] }, [[call("span-read", "read_file")]]);

    expect(plan.unread).toEqual([]);
  });

  it("a subagent call with no id is an unread run with a stand-in id", () => {
    const plan = planSubagentRuns({ runs: [], unplaced: [] }, [[call(undefined, "runSubagent")]]);

    expect(plan.unread).toEqual([expect.objectContaining({ logTurn: 0, label: "runSubagent-unknown", runId: expect.stringMatching(/^[A-Za-z0-9_-]+$/) })]);
  });

  it("a nested ref in a read run's log is an unread depth-2 run under it (D6)", () => {
    const nested = {
      logTurnIndex: 0,
      childSessionId: "call_inner1",
      childLogFile: "runSubagent-Plan-call_inner1.jsonl",
      label: "runSubagent-Plan",
      ts: T0 + 20,
      parentSpanId: "span-inner-run",
    };
    const plan = planSubagentRuns(
      { runs: [run({ log: { status: "read", childLogFile: "x.jsonl", nestedRefs: [nested] } })], unplaced: [] },
      [[call("span-run-call", "runSubagent")]],
    );

    expect(plan.unread).toEqual([
      {
        logTurn: 0,
        runId: "call_inner1",
        label: "runSubagent-Plan",
        depth: 2,
        parentRunId: "call_run1",
        reason: NESTED_SUBAGENT_NOT_READ_REASON,
      },
    ]);
  });

  it("the nested run's own file is not also counted as an unplaced orphan", () => {
    const nested = {
      logTurnIndex: 0,
      childSessionId: "call_inner1",
      childLogFile: "runSubagent-Plan-call_inner1.jsonl",
      label: "runSubagent-Plan",
      ts: null,
      parentSpanId: null,
    };
    const plan = planSubagentRuns(
      {
        runs: [run({ log: { status: "read", childLogFile: "x.jsonl", nestedRefs: [nested] } })],
        unplaced: [{ childLogFile: "runSubagent-Plan-call_inner1.jsonl", reason: SUBAGENT_RUN_UNPLACEABLE_REASON }],
      },
      [[]],
    );

    expect(plan.unread.filter((entry) => entry.logTurn === null)).toEqual([]);
  });

  it("a file no turn could own is a session-level unread run with its reason", () => {
    const plan = planSubagentRuns(
      { runs: [], unplaced: [{ childLogFile: "runSubagent-X-call_x.jsonl", reason: SUBAGENT_RUN_UNPLACEABLE_REASON }] },
      [[]],
    );

    expect(plan.unread).toEqual([{ logTurn: null, depth: 1, reason: SUBAGENT_RUN_UNPLACEABLE_REASON }]);
  });

  it("a missing log reads as the plan's own sentence, with the label", () => {
    const plan = planSubagentRuns(
      { runs: [run({ log: { status: "unread", reason: SUBAGENT_LOG_MISSING_REASON } })], unplaced: [] },
      [[call("span-run-call", "runSubagent")]],
    );

    expect(plan.runsByTurn.get(0)?.[0].log).toEqual({
      status: "unread",
      reason: missingSubagentLogReason("runSubagent-Explore"),
    });
  });

  it("too many logs reads as the plan's own sentence", () => {
    const plan = planSubagentRuns(
      { runs: [run({ log: { status: "unread", reason: SUBAGENT_LOGS_TOO_MANY_REASON } })], unplaced: [] },
      [[]],
    );

    expect(plan.runsByTurn.get(0)?.[0].log).toEqual({ status: "unread", reason: TOO_MANY_SUBAGENT_LOGS_REASON });
  });

  it("any other unread reason stays 10.19's", () => {
    const plan = planSubagentRuns(
      { runs: [run({ log: { status: "unread", reason: SUBAGENT_LOG_NOT_REGULAR_FILE_REASON } })], unplaced: [] },
      [[]],
    );

    expect(plan.runsByTurn.get(0)?.[0].log).toEqual({ status: "unread", reason: SUBAGENT_LOG_NOT_REGULAR_FILE_REASON });
  });

  it("keeps runs in the order the attribution gave them, per turn", () => {
    const plan = planSubagentRuns(
      { runs: [run({ runId: "call_a" }), run({ runId: "call_b", logTurn: 1 }), run({ runId: "call_c" })], unplaced: [] },
      [[], []],
    );

    expect(plan.runsByTurn.get(0)?.map((r) => r.runId)).toEqual(["call_a", "call_c"]);
    expect(plan.runsByTurn.get(1)?.map((r) => r.runId)).toEqual(["call_b"]);
  });
});
