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
    expect(detail().selfCheck).toMatchObject({ status: "passed", callout: false, text: "Self-check passed: 8 of 8 requests match the log (cache read within 5 %)" });
  });

  it("calls out a failed self-check", () => {
    const vm = detail({ selfCheck: { model: "claude-opus-5.5", models: ["claude-opus-5.5"], requests: 8, matching: 6, readTolerancePercent: 5, passed: false } });
    expect(vm.selfCheck).toMatchObject({
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

describe("toReplayViewModel, compare mode, what U12 shows per model (board Replay, plan §9.2 Q1, Q3, Q4)", () => {
  const entry = (model: string, value: number | null, knownTurns: number, extra: { own?: boolean; replayedTurns?: number; vendorId?: string } = {}) => ({
    model,
    vendorId: extra.vendorId ?? "anthropic",
    total: { value, knownTurns, turns: 42 },
    replayedTurns: extra.replayedTurns ?? knownTurns,
    isMeasuredModel: extra.own ?? false,
    isMixedSessionModel: false,
  });
  const compare = (entries: ReturnType<typeof entry>[], measured = 186.4) => {
    const vm = toReplayViewModel(
      replayComparison({
        currency: "AI_CREDITS",
        measured: { value: measured, knownTurns: 42, turns: 42 },
        entries,
      }),
    );
    if (vm.mode !== "compare") throw new Error("expected compare mode");
    return vm;
  };

  it("keeps the tool's order: the entries are not sorted by cost (Q4)", () => {
    const vm = compare([entry("own", 183.9, 42, { own: true }), entry("cheap", 38.2, 42), entry("dear", 312.8, 42)]);
    expect(vm.entries.map((row) => row.model)).toEqual(["own", "cheap", "dear"]);
  });

  it("gives a fully known model a signed percent against the measured total, with a sign that is written", () => {
    const [own, cheap, dear] = compare([entry("own", 183.9, 42, { own: true }), entry("cheap", 38.2, 42), entry("dear", 312.8, 42)]).entries;
    expect(own).toMatchObject({ displayText: "183.90 AI Credits", changeText: "−1.3 %", changeDirection: "decrease", partial: false, subText: "would have cost about" });
    expect(cheap).toMatchObject({ changeText: "−79.5 %", changeDirection: "decrease" });
    expect(dear).toMatchObject({ displayText: "312.80 AI Credits", changeText: "+67.8 %", changeDirection: "increase" });
  });

  it("shows a partly replayed model as a floor with no percent (Q3)", () => {
    const [row] = compare([entry("gpt-6.1-sol", 132.75, 40, { replayedTurns: 40, vendorId: "openai" })]).entries;
    expect(row).toMatchObject({ displayText: "≥ 132.75 AI Credits", partial: true, changeText: "partial", changeDirection: "none", subText: "known for 40 of 42 turns", vendorText: "OpenAI" });
  });

  it("reads Unknown for an unpriced model, with no percent and no figure (Q4)", () => {
    const [row] = compare([entry("local-llama-4", null, 0, { replayedTurns: 42, vendorId: "local" })]).entries;
    expect(row).toMatchObject({ displayText: "Unknown", changeText: "—", changeDirection: "none", partial: false, subText: "replayed 42 of 42 turns, none priced", vendorText: "local" });
    const [none] = compare([entry("local-llama-4", null, 0, { replayedTurns: 0 })]).entries;
    expect(none!.subText).toBe("no turn could be replayed on this model");
  });

  it("gives no percent when the measured total is unknown or zero", () => {
    expect(compare([entry("m", 10, 42)], 0).entries[0]).toMatchObject({ changeText: "—" });
    const unknown = toReplayViewModel(replayComparison({ measured: { value: null, knownTurns: 0, turns: 42 }, currency: "AI_CREDITS", entries: [entry("m", 10, 42)] }));
    if (unknown.mode !== "compare") throw new Error("expected compare mode");
    expect(unknown.entries[0]).toMatchObject({ changeText: "—" });
  });

  it("builds the own-model check from the entry flagged isMeasuredModel (Q1)", () => {
    const vm = compare([entry("claude-sonnet-5.5", 183.9, 42, { own: true }), entry("cheap", 38.2, 42)]);
    expect(vm.measuredModel).toBe("claude-sonnet-5.5");
    expect(vm.ownModelCheck).toEqual({
      status: "shown",
      callout: false,
      text: "replayed on its own model, claude-sonnet-5.5, the session comes to 183.90 AI Credits against 186.40 AI Credits measured (−1.3 %). The request-by-request self-check is on each model's replay.",
    });
  });

  it("names every model a switching session used, in order, and makes no own-model check of the first model's replay", () => {
    const vm = toReplayViewModel(
      replayComparison({
        currency: "AI_CREDITS",
        measured: { value: 186.4, knownTurns: 42, turns: 42 },
        measuredModels: ["claude-sonnet-5.5", "claude-opus-5.5"],
        entries: [{ ...entry("claude-sonnet-5.5", 183.9, 42), isMixedSessionModel: true }, entry("cheap", 38.2, 42)],
      }),
    );
    if (vm.mode !== "compare") throw new Error("expected compare mode");
    expect(vm.measuredModel).toBe("claude-sonnet-5.5, then claude-opus-5.5");
    expect(vm.entries[0]).toMatchObject({ isMeasuredModel: false, noteText: "the session's first model; it switched models" });
    expect(vm.ownModelCheck).toMatchObject({ status: "missing", callout: true });
    expect(vm.ownModelCheck.text).toContain("switched models (claude-sonnet-5.5, then claude-opus-5.5)");
  });

  it("calls out a missing own-model check, and an own model that could not be priced", () => {
    const missing = compare([entry("cheap", 38.2, 42)]);
    expect(missing.measuredModel).toBeUndefined();
    expect(missing.ownModelCheck).toMatchObject({ status: "missing", callout: true });
    expect(missing.ownModelCheck.text).toContain("not among the replayed models");
    const unpriced = compare([entry("claude-sonnet-5.5", null, 0, { own: true, replayedTurns: 42 })]);
    expect(unpriced.ownModelCheck).toMatchObject({ status: "missing", callout: true });
    expect(unpriced.ownModelCheck.text).toContain("Unknown");
    const partial = compare([entry("claude-sonnet-5.5", 120, 40, { own: true })]);
    expect(partial.ownModelCheck).toMatchObject({ status: "missing", callout: true });
    expect(partial.ownModelCheck.text).toContain("40 of 42");
  });

  it("states the session's turn count and the measured figure's own coverage", () => {
    const vm = compare([entry("own", 183.9, 42, { own: true })]);
    expect(vm.turnsText).toBe("42 turns");
    expect(vm.measuredCoverageText).toBe("known for 42 of 42 turns");
    expect(vm.measured).toMatchObject({ text: "186.40 AI Credits", label: "Measured" });
  });
});

describe("toReplayViewModel, the self-check box wording (plan §9.2 Q2)", () => {
  it("words a failed check with the counts and 'treat them as rough'", () => {
    const vm = detail({ selfCheck: { model: "claude-opus-5.5", models: ["claude-opus-5.5"], requests: 44, matching: 37, readTolerancePercent: 5, passed: false } });
    expect(vm.selfCheck.title).toBe("Self-check failed.");
    expect(vm.selfCheck.detail).toBe("Replaying the session on its own model (claude-opus-5.5) matched 37 of 44 requests within 5 % cache read, so the simulated figures below may be off. Treat them as rough, not as a quote.");
  });

  it("names every model a switching session's self-check ran, in order", () => {
    const vm = detail({ selfCheck: { model: "claude-sonnet-5.5", models: ["claude-sonnet-5.5", "claude-opus-5.5"], requests: 3, matching: 2, readTolerancePercent: 5, passed: false } });
    expect(vm.selfCheck.detail).toBe("Replaying the session on its own models (claude-sonnet-5.5, then claude-opus-5.5) matched 2 of 3 requests within 5 % cache read, so the simulated figures below may be off. Treat them as rough, not as a quote.");
    const passed = detail({ selfCheck: { model: "claude-sonnet-5.5", models: ["claude-sonnet-5.5", "claude-opus-5.5"], requests: 3, matching: 3, readTolerancePercent: 5, passed: true } });
    expect(passed.selfCheck.detail).toBe("on claude-sonnet-5.5, then claude-opus-5.5: 3 of 3 requests matched within 5 % cache read.");
  });

  it("words a passed and a missing check", () => {
    expect(detail().selfCheck).toMatchObject({ title: "Self-check passed", detail: "on claude-opus-5.5: 8 of 8 requests matched within 5 % cache read." });
    expect(detail({ selfCheck: null }).selfCheck).toMatchObject({ title: "No self-check.", detail: expect.stringContaining("Treat them as rough") });
  });
});

describe("toReplayViewModel, replay mode, what U12 adds (board Replay, plan §9.2 Q2, Q3)", () => {
  it("carries the currency for the chart axis", () => {
    expect(detail().currency).toBe("USD");
  });

  it("names the measured basis when every known measured turn has it", () => {
    expect(detail().measuredBasisText).toBe("priced");
  });

  it("gives the difference a percent of the measured total", () => {
    const vm = detail({ currency: "AI_CREDITS", totals: { measured: { value: 186.4, knownTurns: 40, turns: 42 }, simulated: { value: 132.75, knownTurns: 40, turns: 42 }, difference: -53.65 } });
    expect(vm.differencePercentText).toBe("−28.8 %");
  });

  it("gives no percent for an unknown or zero measured total", () => {
    expect(detail({ totals: { measured: { value: 0.8, knownTurns: 2, turns: 3 }, simulated: { value: null, knownTurns: 0, turns: 3 }, difference: null } }).differencePercentText).toBeUndefined();
  });

  it("says that turns not replayed are in neither total, with what they measured when known", () => {
    expect(detail().differenceNote).toBe("1 turn not replayed is in neither total");
    const withMeasured = detail({
      currency: "AI_CREDITS",
      turns: [
        { turnIndex: 0, measured: { cacheRead: 1, cost: { known: true, value: 4.26, currency: "AI_CREDITS", basis: "billed" } }, simulated: null, notReplayedReason: NOT_REPLAYED },
        { turnIndex: 1, measured: { cacheRead: 1, cost: { known: true, value: 3.35, currency: "AI_CREDITS", basis: "billed" } }, simulated: null, notReplayedReason: NOT_REPLAYED },
      ],
      totals: { measured: { value: null, knownTurns: 0, turns: 2 }, simulated: { value: null, knownTurns: 0, turns: 2 }, difference: null },
      coverage: { turns: 2, replayedTurns: 0, requests: 2, replayedRequests: 0, notReplayed: [{ reason: NOT_REPLAYED, turns: 2 }] },
    });
    expect(withMeasured.differenceNote).toBe("2 turns not replayed (7.61 AI Credits measured) are in neither total");
  });

  it("has no note when every turn was replayed", () => {
    const turn = replay().turns[0]!;
    const full = detail({ turns: [turn], coverage: { turns: 1, replayedTurns: 1, requests: 3, replayedRequests: 3, notReplayed: [] } });
    expect(full.differenceNote).toBeUndefined();
  });
});
