// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { ReplayTurnRow } from "../../view-models/index.js";
import { buildReplayChart, describeReplayChart } from "./chart-model.js";

const figure = (amount: number | null, label: "Measured" | "Simulated") => ({ text: amount === null ? "Unknown" : `${amount.toFixed(2)} AI Credits`, amount, known: amount !== null, label }) as const;

function turn(turnIndex: number, measured: number | null, simulated: number | null, replayed = true, reason = "no request trace for the turn"): ReplayTurnRow {
  return {
    turnIndex,
    replayed,
    ...(replayed ? { outcomeText: "cache hit" } : { notReplayedReason: reason }),
    measured: figure(measured, "Measured"),
    simulated: figure(simulated, "Simulated"),
  };
}

describe("buildReplayChart", () => {
  it("draws one measured and one simulated run over turns that are all known", () => {
    const chart = buildReplayChart([turn(0, 2, 1), turn(1, 4, 3), turn(2, 3, 2)], "AI_CREDITS");
    expect(chart.measured).toEqual([[{ index: 0, value: 2, title: "Turn 0: measured 2.00 AI Credits" }, { index: 1, value: 4, title: "Turn 1: measured 4.00 AI Credits" }, { index: 2, value: 3, title: "Turn 2: measured 3.00 AI Credits" }]]);
    expect(chart.simulated).toHaveLength(1);
    expect(chart.simulated[0]!.map((point) => point.value)).toEqual([1, 3, 2]);
    expect(chart.max).toBe(4);
    expect(chart.gaps).toEqual([]);
  });

  it("leaves a gap for turns not replayed: the simulated line breaks and a band names the turns (Q5)", () => {
    const chart = buildReplayChart([turn(0, 2, 1), turn(1, 3, null, false), turn(2, 3, null, false), turn(3, 4, 2)], "AI_CREDITS");
    expect(chart.simulated.map((run) => run.map((point) => point.index))).toEqual([[0], [3]]);
    expect(chart.gaps).toEqual([{ from: 1, to: 2, title: "Turns 1 and 2: not replayed, no request trace for the turn" }]);
    // The measured line goes on: the log has those turns.
    expect(chart.measured).toHaveLength(1);
  });

  it("words one turn, a run of three and mixed reasons", () => {
    expect(buildReplayChart([turn(0, 1, null, false)], "USD").gaps[0]!.title).toBe("Turn 0: not replayed, no request trace for the turn");
    const three = buildReplayChart([turn(4, 1, null, false), turn(5, 1, null, false), turn(6, 1, null, false)], "USD").gaps[0]!;
    expect(three.title).toBe("Turns 4 to 6: not replayed, no request trace for the turn");
    const mixed = buildReplayChart([turn(0, 1, null, false, "a"), turn(1, 1, null, false, "b")], "USD").gaps[0]!;
    expect(mixed.title).toBe("Turns 0 and 1: not replayed, for 2 reasons");
  });

  it("breaks a line at an unknown figure and never draws it as 0", () => {
    const chart = buildReplayChart([turn(0, 2, 1), turn(1, null, null), turn(2, 3, 2)], "AI_CREDITS");
    expect(chart.measured.map((run) => run.map((point) => point.value))).toEqual([[2], [3]]);
    expect(chart.simulated.map((run) => run.map((point) => point.value))).toEqual([[1], [2]]);
    expect(chart.gaps).toEqual([]);
  });

  it("has no maximum and no runs when nothing is known", () => {
    const chart = buildReplayChart([turn(0, null, null), turn(1, null, null)], "AI_CREDITS");
    expect(chart).toMatchObject({ max: null, measured: [], simulated: [] });
  });

  it("keeps the turn index of a point, not its position, for the label", () => {
    const chart = buildReplayChart([turn(7, 1, 1), turn(8, 2, 2)], "AI_CREDITS");
    expect(chart.turnIndexes).toEqual([7, 8]);
  });
});

describe("describeReplayChart", () => {
  it("names the series, the size and what is not replayed", () => {
    const chart = buildReplayChart([turn(0, 2, 1), turn(1, 4, null, false), turn(2, 3, 2)], "AI_CREDITS");
    const text = describeReplayChart(chart, "claude-haiku-5.5");
    expect(text).toContain("AI Credits per turn, measured and simulated on claude-haiku-5.5");
    expect(text).toContain("3 turns");
    expect(text).toContain("1 turn not replayed");
    expect(text).toContain("highest measured 4.00 AI Credits at turn 1");
  });

  it("says when no figure is known", () => {
    expect(describeReplayChart(buildReplayChart([turn(0, null, null)], "USD"), "m")).toContain("no figure known");
  });
});
