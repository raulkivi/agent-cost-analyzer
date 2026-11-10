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

  // A16: Copilot Agent Host sessions log uncached input and cache reads but
  // no cache writes, so the total stays Unknown (constraint 6) and the note
  // gives the parts that are known.
  it("notes the known input parts when cache writes are not logged", () => {
    const cost = sessionCost({
      totals: measures(1, {
        uncachedInput: total(14_788, 1, 1),
        cacheWrite: total(null, 0, 1),
        cacheRead: total(119_322, 1, 1),
        inputTokens: total(null, 0, 1),
      }),
      cacheHitRatio: null,
    });
    const { tiles } = toSessionCostViewModel(cost);
    expect(tiles.inputTokens).toEqual({ text: "Unknown", known: false, estimate: false, unknownNote: "14.8 k uncached + 119 k cache read; cache writes not logged" });
    expect(tiles.cacheHit).toEqual({ text: "Unknown", known: false, estimate: false, unknownNote: "cache writes not logged" });
  });

  it("names every missing input part", () => {
    const cost = sessionCost({
      totals: measures(1, {
        uncachedInput: total(500, 1, 1),
        cacheWrite: total(null, 0, 1),
        cacheRead: total(null, 0, 1),
        inputTokens: total(null, 0, 1),
      }),
      cacheHitRatio: null,
    });
    const { tiles } = toSessionCostViewModel(cost);
    expect(tiles.inputTokens.unknownNote).toBe("500 uncached; cache writes and cache reads not logged");
    expect(tiles.cacheHit.unknownNote).toBe("cache writes and cache reads not logged");
  });

  it("adds no note when no input part is known", () => {
    const cost = sessionCost({
      totals: measures(1, {
        uncachedInput: total(null, 0, 1),
        cacheWrite: total(null, 0, 1),
        cacheRead: total(null, 0, 1),
        inputTokens: total(null, 0, 1),
      }),
      cacheHitRatio: null,
    });
    const { tiles } = toSessionCostViewModel(cost);
    expect(tiles.inputTokens.unknownNote).toBeUndefined();
    expect(tiles.cacheHit.unknownNote).toBeUndefined();
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
      excerptRecorded: true,
      eventLabel: "compaction",
      aiCredits: { text: "4.10", known: true, estimate: false },
      inputTokens: { text: "310 k", known: true, estimate: false },
    });
    expect(topTurns[1]?.eventLabel).toBe("model switch");
  });

  // A16: a turn whose text the log lacks has an empty excerpt.
  it.each(["", "  "])("says the prompt was not recorded for the excerpt %j", (userMessage) => {
    const base = sessionCost();
    const cost = sessionCost({ topTurns: [{ ...base.topTurns[0]!, userMessage }] });
    expect(toSessionCostViewModel(cost).topTurns[0]).toMatchObject({ excerpt: "Prompt not recorded", excerptRecorded: false });
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
        value: 21_000,
        components: [
          { label: "Custom instructions", tokens: { text: "3 k", known: true, estimate: false }, value: 3000 },
          { label: "Tool definitions", tokens: { text: "Unknown", known: false, estimate: false }, value: null },
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

describe("toSessionCostViewModel chart measure", () => {
  const byTokens = () => toSessionCostViewModel(sessionCost({ rankedBy: "inputTokens" }), turnSeries()).chart;

  it("keeps the AI Credits titles and axis text when ranked by AI Credits", () => {
    const chart = toSessionCostViewModel(sessionCost({ rankedBy: "aiCredits" }), turnSeries()).chart;
    expect(chart).toMatchObject({ title: "AI Credits per turn", unitLabel: "AI Credits", maxText: "4.10" });
  });

  it("plots input tokens, formatted as tokens, when ranked by input tokens", () => {
    const chart = byTokens();
    expect(chart).toMatchObject({ title: "Input tokens per turn", unitLabel: "input tokens", maxValue: 310_000, maxText: "310 k" });
    expect(chart?.points[0]).toMatchObject({ value: 100, text: "100" });
    expect(chart?.points[2]).toMatchObject({ value: 310_000, text: "310 k", estimate: true });
  });

  it("draws a turn without input tokens as a gap and notes it", () => {
    const chart = byTokens();
    expect(chart?.points[1]).toMatchObject({ value: null, text: "Unknown", unknown: true });
    expect(chart?.unknownNote).toBe("1 turn unknown");
  });

  it("has no axis text when no turn is known", () => {
    const turns = turnSeries().turns.map((turn) => ({ ...turn, inputTokens: null }));
    expect(toSessionCostViewModel(sessionCost({ rankedBy: "inputTokens" }), turnSeries({ turns })).chart).toMatchObject({ maxValue: null, maxText: null });
  });
});

describe("toSessionCostViewModel ranking", () => {
  it("names AI Credits as the ranking by default", () => {
    const vm = toSessionCostViewModel(sessionCost());
    expect(vm.rankedBy).toBe("aiCredits");
    expect(vm.rankingLabel).toBe("AI Credits");
  });

  it("names input tokens when the turns were ranked by them", () => {
    const vm = toSessionCostViewModel(sessionCost({ rankedBy: "inputTokens" }));
    expect(vm.rankedBy).toBe("inputTokens");
    expect(vm.rankingLabel).toBe("input tokens");
  });
});

describe("toSessionCostViewModel active flag (plan §4.7)", () => {
  it("carries the server's flag and the note when the session is active", () => {
    const vm = toSessionCostViewModel(sessionCost({ active: true, lastTurnAt: "2026-11-10T10:00:00Z" }));
    expect(vm.active).toBe(true);
    expect(vm.activeNote).toBe("Active session: figures may still change; the latest turn may be incomplete.");
    expect(vm.activeHint).toBe("Latest turn started in the last 15 minutes; figures may still change");
  });

  it("is inactive, without a note, when the flag is false or absent", () => {
    for (const cost of [sessionCost(), sessionCost({ active: false })]) {
      const vm = toSessionCostViewModel(cost);
      expect(vm.active).toBe(false);
      expect(vm.activeNote).toBeUndefined();
      expect(vm.activeHint).toBeUndefined();
    }
  });
});
