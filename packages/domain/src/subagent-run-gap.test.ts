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

describe("Turn.subagentRunsRead", () => {
  const base = {
    index: 0,
    userMessage: "",
    assistantResponse: "",
    toolCalls: [],
    explanation: "",
    usage: {
      uncachedInput: { known: true, value: 1 },
      cacheWrite: { known: true, value: 0 },
      cacheRead: { known: true, value: 0 },
      tool: { known: true, value: 0 },
      vision: { known: true, value: 0 },
      reasoning: { known: true, value: 0 },
      output: { known: true, value: 1 },
      costAiCredits: { known: true, value: 0 },
      model: "m",
    },
  };

  it("is optional and takes run ids", () => {
    expect(turnSchema.parse(base).subagentRunsRead).toBeUndefined();
    expect(turnSchema.parse({ ...base, subagentRunsRead: ["child-1"] }).subagentRunsRead).toEqual(["child-1"]);
  });

  it("rejects a hostile id and a list over 200", () => {
    expect(() => turnSchema.parse({ ...base, subagentRunsRead: ["../x"] })).toThrow();
    expect(() => turnSchema.parse({ ...base, subagentRunsRead: Array.from({ length: 201 }, (_, n) => `r${n}`) })).toThrow();
  });
});


describe("Turn.subagentRunsByTime", () => {
  const base = {
    index: 0,
    userMessage: "",
    assistantResponse: "",
    toolCalls: [],
    explanation: "",
    usage: {
      uncachedInput: { known: true, value: 1 },
      cacheWrite: { known: true, value: 0 },
      cacheRead: { known: true, value: 0 },
      tool: { known: true, value: 0 },
      vision: { known: true, value: 0 },
      reasoning: { known: true, value: 0 },
      output: { known: true, value: 1 },
      costAiCredits: { known: true, value: 0 },
      model: "m",
    },
  };

  it("is optional and takes run ids", () => {
    expect(turnSchema.parse(base).subagentRunsByTime).toBeUndefined();
    expect(turnSchema.parse({ ...base, subagentRunsByTime: ["child-1"] }).subagentRunsByTime).toEqual(["child-1"]);
  });

  it("rejects a hostile id and a list over 200", () => {
    expect(() => turnSchema.parse({ ...base, subagentRunsByTime: ["../x"] })).toThrow();
    expect(() => turnSchema.parse({ ...base, subagentRunsByTime: Array.from({ length: 201 }, (_, n) => `r${n}`) })).toThrow();
  });
});
