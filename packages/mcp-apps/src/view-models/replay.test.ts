// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { NOT_REPLAYED, replay, replayComparison } from "./increment3-fixtures.js";
import { toReplayViewModel } from "./replay.js";
import type { ReplayCompareViewModel, ReplayDetailViewModel } from "./replay.js";

function detail(...args: Parameters<typeof replay>): ReplayDetailViewModel {
  const vm = toReplayViewModel(replay(...args));
  if (vm.mode !== "replay") throw new Error("expected replay mode");
  return vm;
}

describe("toReplayViewModel, replay mode", () => {
  it("labels the answer and its figures simulated, and keeps the measured one apart", () => {
    const vm = detail();
    expect(vm).toMatchObject({ mode: "replay", label: "Simulated", sessionId: "s1", model: "claude-sonnet-5.5", measuredModelsText: "claude-opus-5.5" });
    expect(vm.simulated).toMatchObject({ text: "$0.48", amount: 0.48, known: true, label: "Simulated", coverageNote: "known for 2 of 3 turns" });
    expect(vm.measured).toMatchObject({ text: "$0.80", label: "Measured", coverageNote: "known for 2 of 3 turns" });
    expect(vm.difference).toMatchObject({ text: "−$0.32", label: "Simulated" });
    expect(vm.headline).toBe("would have cost about $0.48");
  });

  it("shows AI Credits with their suffix when the replay is in AI Credits", () => {
    const vm = detail({ currency: "AI_CREDITS", totals: { measured: { value: 12, knownTurns: 3, turns: 3 }, simulated: { value: 9.5, knownTurns: 3, turns: 3 }, difference: -2.5 } });
    expect(vm.simulated.text).toBe("9.50 AI Credits");
    expect(vm.difference.text).toBe("−2.50 AI Credits");
    expect(vm.simulated.coverageNote).toBeUndefined();
  });

  it("reads Unknown for a null total and a null difference, never 0", () => {
    const vm = detail({ totals: { measured: { value: 0.8, knownTurns: 2, turns: 3 }, simulated: { value: null, knownTurns: 0, turns: 3 }, difference: null } });
    expect(vm.simulated).toMatchObject({ text: "Unknown", amount: null, known: false, label: "Simulated" });
    expect(vm.difference).toMatchObject({ text: "Unknown", amount: null, known: false, label: "Simulated" });
    expect(vm.headline).toBe("Unknown");
  });

  it("says which prices the figures use, or why there are none", () => {
    expect(detail().pricingText).toBe("priced at the vendor's API prices as of 2026-10-21");
    expect(detail({ pricing: { channel: "copilot", asOf: "2026-10-21", requested: "copilot" } }).pricingText).toBe("priced at Copilot's AI Credit prices as of 2026-10-21");
    expect(detail({ pricing: { channel: null, reason: "The vendor lists no API channel", asOf: "2026-10-21", requested: "api" } }).pricingText).toBe("not priced: The vendor lists no API channel");
  });

  it("shows a passed self-check as passed, with the match count", () => {
    expect(detail().selfCheck).toEqual({ status: "passed", callout: false, text: "Self-check passed: 8 of 8 requests match the log (cache read within 5 %)" });
  });

  it("calls out a failed self-check", () => {
    const vm = detail({ selfCheck: { model: "claude-opus-5.5", requests: 8, matching: 6, readTolerancePercent: 5, passed: false } });
    expect(vm.selfCheck).toEqual({
      status: "failed",
      callout: true,
      text: "Self-check failed: 6 of 8 requests match the log (cache read within 5 %); don't rely on the simulated figures",
    });
  });

  it("calls out a missing self-check", () => {
    const vm = detail({ selfCheck: null });
    expect(vm.selfCheck).toMatchObject({ status: "missing", callout: true });
    expect(vm.selfCheck.text).toContain("No self-check");
  });

  it("states coverage and each reason a turn was not replayed", () => {
    expect(detail().coverage).toEqual({ text: "2 of 3 turns replayed", partial: true, notReplayed: [{ reason: NOT_REPLAYED, turnsText: "1 turn" }] });
    const full = detail({ coverage: { turns: 3, replayedTurns: 3, requests: 9, replayedRequests: 9, notReplayed: [] } });
    expect(full.coverage).toMatchObject({ text: "3 of 3 turns replayed", partial: false, notReplayed: [] });
  });

  it("lists turns with measured and simulated figures, and the reason for an unreplayed one", () => {
    const [first, second] = detail().turns;
    expect(first).toMatchObject({ turnIndex: 0, replayed: true, outcomeText: "partial cache hit" });
    expect(first!.measured).toMatchObject({ text: "$0.52", label: "Measured" });
    expect(first!.simulated).toMatchObject({ text: "$0.31", label: "Simulated" });
    expect(second).toMatchObject({ turnIndex: 1, replayed: false, notReplayedReason: NOT_REPLAYED });
    expect(second!.measured).toMatchObject({ text: "Unknown", known: false, unknownNote: "A request in this turn has no cost figures" });
    expect(second!.simulated).toMatchObject({ text: "Unknown", known: false, label: "Simulated", unknownNote: NOT_REPLAYED });
  });

  it("words the assumptions with their confidence", () => {
    expect(detail().assumptions).toEqual([{ id: "A1", text: "Same conversation: the other model gets the same prompts.", confidenceText: "unknown" }]);
  });
});

describe("toReplayViewModel, compare mode", () => {
  function compare(...args: Parameters<typeof replayComparison>): ReplayCompareViewModel {
    const vm = toReplayViewModel(replayComparison(...args));
    if (vm.mode !== "compare") throw new Error("expected compare mode");
    return vm;
  }

  it("picks the mode from the input and labels every figure", () => {
    const vm = compare();
    expect(vm).toMatchObject({ mode: "compare", label: "Simulated", sessionId: "s1", measured: { text: "$0.80", label: "Measured" } });
    expect(vm.entries.map((entry) => entry.total.label)).toEqual(["Simulated", "Simulated", "Simulated"]);
  });

  it("gives each model its figure and coverage; an unknown reads Unknown", () => {
    const [opus, sonnet, gpt] = compare().entries;
    expect(opus).toMatchObject({ model: "claude-opus-5.5", isMeasuredModel: true, noteText: "the model the session used", replayedTurnsText: "2 of 3 turns replayed" });
    expect(sonnet).toMatchObject({ model: "claude-sonnet-5.5", isMeasuredModel: false, total: { text: "$0.48", known: true } });
    expect(gpt).toMatchObject({ model: "gpt-6.1-sol", total: { text: "Unknown", amount: null, known: false }, replayedTurnsText: "0 of 3 turns replayed" });
  });
});
