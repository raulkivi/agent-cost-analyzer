// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { subagentRunGapSchema } from "./subagent-run-gap.js";
import { turnSchema } from "./turn.js";

const gap = { runId: "child-1", label: "runSubagent-Explore", depth: 1, reason: "The subagent log is missing." } as const;

describe("subagentRunGapSchema", () => {
  it("accepts a gap with and without a parent run", () => {
    expect(subagentRunGapSchema.parse(gap)).toEqual(gap);
    expect(subagentRunGapSchema.parse({ ...gap, depth: 2, parentRunId: "parent_1" }).parentRunId).toBe("parent_1");
  });

  it("rejects an empty reason, a hostile id or label, and a depth outside 1-8", () => {
    expect(() => subagentRunGapSchema.parse({ ...gap, reason: "" })).toThrow();
    expect(() => subagentRunGapSchema.parse({ ...gap, runId: "../x" })).toThrow();
    expect(() => subagentRunGapSchema.parse({ ...gap, label: "<script>" })).toThrow();
    expect(() => subagentRunGapSchema.parse({ ...gap, depth: 9 })).toThrow();
  });

  it("is optional on a turn", () => {
    const turn = {
      index: 0,
      userMessage: "",
      assistantResponse: "",
      toolCalls: [],
      explanation: "",
      usage: {
        uncachedInput: { known: true, value: 1 },
        cacheWrite: { known: true, value: 0 },
        cacheRead: { known: true, value: 0 },
        tool: { known: false, reason: "n/a" },
        vision: { known: false, reason: "n/a" },
        reasoning: { known: false, reason: "n/a" },
        output: { known: true, value: 1 },
        costAiCredits: { known: false, reason: "n/a" },
        model: "m",
      },
    };
    expect(turnSchema.parse(turn).subagentRunGaps).toBeUndefined();
    expect(turnSchema.parse({ ...turn, subagentRunGaps: [gap] }).subagentRunGaps).toEqual([gap]);
  });
});
