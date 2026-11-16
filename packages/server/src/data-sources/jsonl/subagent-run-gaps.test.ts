// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { subagentRunGapSchema } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { gapsByLogTurn } from "./subagent-run-gaps.js";

describe("gapsByLogTurn", () => {
  it("turns each unread run on a turn into a gap, keeping depth and parent", () => {
    const gaps = gapsByLogTurn(
      [
        { logTurn: 1, runId: "call_a", label: "runSubagent-Explore", depth: 1, reason: "why a" },
        { logTurn: 1, runId: "call_b", label: "runSubagent-Plan", depth: 2, parentRunId: "call_a", reason: "why b" },
      ],
      3,
    );

    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toEqual([]);
    expect(gaps[1]).toEqual([
      { runId: "call_a", label: "runSubagent-Explore", depth: 1, reason: "why a" },
      { runId: "call_b", label: "runSubagent-Plan", depth: 2, parentRunId: "call_a", reason: "why b" },
    ]);
    expect(gaps[1].every((gap) => subagentRunGapSchema.safeParse(gap).success)).toBe(true);
  });

  it("leaves out a run no turn owns: it has no turn to show on", () => {
    expect(gapsByLogTurn([{ logTurn: null, depth: 1, reason: "orphan" }], 1)).toEqual([[]]);
  });

  it("states a run once per turn", () => {
    const run = { logTurn: 0, runId: "call_a", label: "searchSubagent", depth: 1, reason: "first" };

    expect(gapsByLogTurn([run, { ...run, reason: "second" }], 1)[0]).toEqual([
      { runId: "call_a", label: "searchSubagent", depth: 1, reason: "first" },
    ]);
  });

  it("cuts a reason to the gap's cap", () => {
    const [[gap]] = gapsByLogTurn([{ logTurn: 0, runId: "call_a", label: "searchSubagent", depth: 1, reason: "x".repeat(900) }], 1);

    expect(gap.reason).toHaveLength(500);
    expect(subagentRunGapSchema.safeParse(gap).success).toBe(true);
  });

  it("clamps a depth to the shape's 1 to 8", () => {
    const [[gap]] = gapsByLogTurn([{ logTurn: 0, runId: "call_a", label: "searchSubagent", depth: 12, reason: "deep" }], 1);

    expect(gap.depth).toBe(8);
  });
});
