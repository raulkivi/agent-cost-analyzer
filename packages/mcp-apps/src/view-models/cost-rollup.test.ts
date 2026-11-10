// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { toCostRollupViewModel } from "./cost-rollup.js";
import { costRollup, measures, total } from "./fixtures.js";

describe("toCostRollupViewModel header and tiles", () => {
  it("writes the period and the four tiles like the approved board", () => {
    const vm = toCostRollupViewModel(costRollup());
    expect(vm.periodText).toBe("Oct 27 – Nov 2");
    expect(vm.tiles.aiCredits).toEqual({ text: "142.60", known: true, estimate: false, coverageNote: "known for 318 of 334 turns" });
    expect(vm.tiles.sessions.text).toBe("23");
    expect(vm.tiles.turns.text).toBe("334");
    expect(vm.tiles.cacheHit.text).toBe("81 %");
  });

  it("handles open-ended and missing periods", () => {
    expect(toCostRollupViewModel(costRollup({ until: undefined })).periodText).toBe("since Oct 27");
    expect(toCostRollupViewModel(costRollup({ since: undefined })).periodText).toBe("until Nov 2");
    expect(toCostRollupViewModel(costRollup({ since: undefined, until: undefined })).periodText).toBeUndefined();
  });

  it("shows Unknown, never 0, for a total with no known turns", () => {
    const vm = toCostRollupViewModel(costRollup({ totals: measures(334, { aiCredits: total(null, 0, 334) }), cacheHitRatio: null }));
    expect(vm.tiles.aiCredits).toMatchObject({ text: "Unknown", known: false });
    expect(vm.tiles.cacheHit).toMatchObject({ text: "Unknown", known: false });
  });

  it("says which input part is not logged when the cache hit is Unknown (A16)", () => {
    const totals = measures(3, { cacheWrite: total(null, 0, 3), inputTokens: total(null, 0, 3) });
    const vm = toCostRollupViewModel(costRollup({ totals, cacheHitRatio: null }));
    expect(vm.tiles.cacheHit).toEqual({ text: "Unknown", known: false, estimate: false, unknownNote: "cache writes not logged" });
  });
});

describe("toCostRollupViewModel daily spend", () => {
  it("labels each day and keeps unknown days as gaps", () => {
    const { daily } = toCostRollupViewModel(costRollup());
    expect(daily.points.map((day) => day.label)).toEqual(["Oct 27", "Oct 28", "Oct 29"]);
    expect(daily.points[1]).toMatchObject({ value: null, text: "Unknown", unknown: true });
    expect(daily.points[2]).toMatchObject({ value: 112.6, text: "112.60", unknown: false });
    expect(daily.maxValue).toBe(112.6);
  });
});

describe("toCostRollupViewModel shares", () => {
  it("ranks models and providers with their share of the total", () => {
    const vm = toCostRollupViewModel(costRollup());
    expect(vm.byModel[0]).toEqual({
      label: "claude-sonnet-5.5",
      aiCredits: { text: "88.10", known: true, estimate: false },
      shareText: "62 %",
      share: 88.1 / 142.6,
    });
    expect(vm.byProvider[0]).toMatchObject({ label: "Copilot Chat", shareText: "67 %" });
  });

  it("shows Unknown for a group without a known figure and gives it no share", () => {
    const row = toCostRollupViewModel(costRollup()).byModel[2];
    expect(row).toMatchObject({ label: "mystery-model", shareText: "Unknown", share: null });
    expect(row?.aiCredits.text).toBe("Unknown");
  });

  it("gives no share when the total itself is unknown or zero", () => {
    const unknown = toCostRollupViewModel(costRollup({ totals: measures(334, { aiCredits: total(null, 0, 334) }) }));
    expect(unknown.byModel[0]?.share).toBeNull();
    const zero = toCostRollupViewModel(costRollup({ totals: measures(334, { aiCredits: total(0, 334, 334) }) }));
    expect(zero.byModel[0]?.share).toBeNull();
  });
});

describe("toCostRollupViewModel top sessions", () => {
  it("lists sessions with ids, turns, credits and partial coverage", () => {
    const { topSessions } = toCostRollupViewModel(costRollup());
    expect(topSessions[0]).toEqual({
      active: false,
      providerId: "copilot",
      sessionId: "7f3a9c2e",
      title: "Refactor provider registry",
      model: "claude-sonnet-5.5",
      turnsText: "42 turns",
      startedText: "Oct 27",
      aiCredits: { text: "18.42", known: true, estimate: false, coverageNote: "known for 40 of 42 turns" },
      inputTokens: { text: "Unknown", known: false, estimate: false },
    });
  });

  it("shows Unknown for a session without a known figure", () => {
    const row = toCostRollupViewModel(costRollup()).topSessions[1];
    expect(row?.aiCredits).toMatchObject({ text: "Unknown", known: false });
    expect(row?.startedText).toBeUndefined();
  });
});

describe("toCostRollupViewModel ranking", () => {
  it("names AI Credits as the ranking by default", () => {
    const vm = toCostRollupViewModel(costRollup());
    expect(vm.rankedBy).toBe("aiCredits");
    expect(vm.rankingLabel).toBe("AI Credits");
  });

  it("names input tokens and formats each session's input tokens, Unknown when missing", () => {
    const base = costRollup();
    const topSessions = [{ ...base.topSessions[0]!, inputTokens: 2_100_000 }, { ...base.topSessions[1]!, inputTokens: null }];
    const vm = toCostRollupViewModel({ ...base, rankedBy: "inputTokens", topSessions });
    expect(vm.rankedBy).toBe("inputTokens");
    expect(vm.rankingLabel).toBe("input tokens");
    expect(vm.topSessions[0]?.inputTokens).toMatchObject({ text: "2.1 M", known: true });
    expect(vm.topSessions[1]?.inputTokens).toMatchObject({ text: "Unknown", known: false });
  });
});

describe("toCostRollupViewModel active sessions (plan §4.7)", () => {
  it("carries the server's flag per top session, false when absent", () => {
    const base = costRollup();
    const [first, second] = base.topSessions;
    const vm = toCostRollupViewModel(costRollup({ topSessions: [{ ...first!, active: true }, { ...second!, active: false }, { ...first!, sessionId: "no-flag" }] }));
    expect(vm.topSessions.map((session) => session.active)).toEqual([true, false, false]);
    expect(vm.topSessions[0]?.activeHint).toBe("Latest turn started in the last 15 minutes; figures may still change");
    expect(vm.topSessions[1]?.activeHint).toBeUndefined();
  });
});
