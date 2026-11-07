// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { measures, sessionCost, total, turnSeries } from "./fixtures.js";
import { toSessionCostViewModel } from "./session-cost.js";

describe("toSessionCostViewModel header", () => {
  it("names the session, model, turn count and start day", () => {
    const vm = toSessionCostViewModel(sessionCost());
    expect(vm).toMatchObject({
      sessionId: "7f3a9c2e",
      title: "Refactor provider registry",
      model: "claude-sonnet-5.5",
      turnsText: "42 turns",
      startedText: "Oct 27",
    });
  });

  it("omits the start day when the log records none", () => {
    expect(toSessionCostViewModel(sessionCost({ startedAt: undefined })).startedText).toBeUndefined();
  });
});

describe("toSessionCostViewModel tiles", () => {
  it("formats the four tiles like the approved board", () => {
    const { tiles } = toSessionCostViewModel(sessionCost());
    expect(tiles.aiCredits).toEqual({ text: "18.42", known: true, estimate: false, coverageNote: "known for 40 of 42 turns" });
    expect(tiles.inputTokens).toEqual({ text: "2.1 M", known: true, estimate: false });
    expect(tiles.cacheHit).toEqual({ text: "87 %", known: true, estimate: false });
    expect(tiles.output).toEqual({ text: "64 k", known: true, estimate: true });
  });

  it("shows Unknown, never 0, when no cost data exists", () => {
    const cost = sessionCost({
      totals: measures(14, { aiCredits: total(null, 0, 14) }),
      cacheHitRatio: null,
    });
    const { tiles } = toSessionCostViewModel(cost);
    expect(tiles.aiCredits).toMatchObject({ text: "Unknown", known: false, estimate: false });
    expect(tiles.aiCredits.coverageNote).toBeUndefined();
    expect(tiles.cacheHit).toMatchObject({ text: "Unknown", known: false });
  });

  it("rounds AI Credits to 2 decimal places", () => {
    const cost = sessionCost({ totals: measures(2, { aiCredits: total(2.79598, 2, 2) }) });
    expect(toSessionCostViewModel(cost).tiles.aiCredits.text).toBe("2.80");
  });
});

describe("toSessionCostViewModel top turns", () => {
  it("lists each turn with its excerpt, event tag and figures", () => {
    const { topTurns } = toSessionCostViewModel(sessionCost());
    expect(topTurns[0]).toEqual({
      turnIndex: 17,
      excerpt: "Rewrite the decoder to stream frames instead of…",
      eventLabel: "compaction",
      aiCredits: { text: "4.10", known: true, estimate: false },
      inputTokens: { text: "310 k", known: true, estimate: false },
    });
    expect(topTurns[1]?.eventLabel).toBe("model switch");
  });

  it("shows Unknown for a turn without figures and gives it no event tag", () => {
    const turn = toSessionCostViewModel(sessionCost()).topTurns[2];
    expect(turn?.aiCredits.text).toBe("Unknown");
    expect(turn?.inputTokens.text).toBe("Unknown");
    expect(turn?.eventLabel).toBeUndefined();
  });
});

describe("toSessionCostViewModel context overhead", () => {
  it("reports the system prompt, its components and the unused tools", () => {
    const { contextOverhead } = toSessionCostViewModel(sessionCost());
    expect(contextOverhead).toEqual({
      systemPrompt: {
        tokens: { text: "21 k", known: true, estimate: false },
        components: [
          { label: "Custom instructions", tokens: { text: "3 k", known: true, estimate: false } },
          { label: "Tool definitions", tokens: { text: "Unknown", known: false, estimate: false } },
        ],
      },
      unusedToolsText: "14 of 52 tools unused",
    });
  });

  it("carries the reason when the overhead is unavailable", () => {
    const cost = sessionCost({ contextOverhead: { unavailableReason: "The log has no system prompt." } });
    expect(toSessionCostViewModel(cost).contextOverhead).toEqual({ unavailableReason: "The log has no system prompt." });
  });

  it("does not carry tool names", () => {
    expect(JSON.stringify(toSessionCostViewModel(sessionCost()))).not.toContain("secret_tool_name");
  });
});

describe("toSessionCostViewModel chart", () => {
  it("has no chart without a series", () => {
    expect(toSessionCostViewModel(sessionCost()).chart).toBeUndefined();
  });

  it("draws an unknown turn as Unknown, not as a zero bar", () => {
    const chart = toSessionCostViewModel(sessionCost(), turnSeries()).chart;
    expect(chart?.points[1]).toMatchObject({ turnIndex: 1, value: null, text: "Unknown", unknown: true });
    expect(chart?.points[3]).toMatchObject({ turnIndex: 3, value: 0, text: "0.00", unknown: false });
    expect(chart?.unknownNote).toBe("1 turn unknown");
  });

  it("marks events, estimates and the largest known value", () => {
    const chart = toSessionCostViewModel(sessionCost(), turnSeries()).chart;
    expect(chart?.points[2]).toMatchObject({ value: 4.1, text: "4.10", estimate: true, eventLabels: ["compaction", "model switch"] });
    expect(chart?.maxValue).toBe(4.1);
  });

  it("says so when every turn is unknown", () => {
    const series = turnSeries({
      totalTurns: 2,
      turns: [
        { turnIndex: 0, model: "m", aiCredits: null, inputTokens: null, cacheRead: null, output: null, estimated: true, events: [] },
        { turnIndex: 1, model: "m", aiCredits: null, inputTokens: null, cacheRead: null, output: null, estimated: false, events: [] },
      ],
    });
    const chart = toSessionCostViewModel(sessionCost(), series).chart;
    expect(chart?.maxValue).toBeNull();
    expect(chart?.unknownNote).toBe("unknown for all 2 turns");
    expect(chart?.points.every((point) => !point.estimate)).toBe(true);
  });

  it("notes a truncated series", () => {
    const chart = toSessionCostViewModel(sessionCost(), turnSeries({ totalTurns: 900, truncated: true })).chart;
    expect(chart?.truncatedNote).toBe("showing the first 4 of 900 turns");
  });

  it("ignores a series that belongs to another session", () => {
    expect(toSessionCostViewModel(sessionCost(), turnSeries({ sessionId: "other" })).chart).toBeUndefined();
  });
});
