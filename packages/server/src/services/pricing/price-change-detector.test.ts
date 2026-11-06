import { describe, expect, it } from "vitest";
import { observedPriceChangeSchema, type PriceBookEntry } from "@agent-cost-analyzer/domain";
import { billed, costs, priced } from "../../test-support/cost-cube-fakes.js";
import { PriceChangeDetector, type ObservedTurn } from "./price-change-detector.js";

// Phase 15 step 15.10 (plan §6.4, D11): documented changes are price-book
// version boundaries; observed ones are a steady gap between what GitHub
// billed and what the price book gives for the same Copilot turns: more
// than 5% the same way in 2 ISO weeks in a row, each with 20+ turns that
// have both figures.

const COPILOT = "github-copilot";
const VERSION = "github-copilot:claude-sonnet-5.5:2026-10-01";

// `count` Copilot turns on `date`, each billed `ratio` × its priced 10 AI Credits.
function turns(date: string, count: number, ratio: number, overrides: Partial<ObservedTurn> = {}): ObservedTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    date,
    model: "claude-sonnet-5.5",
    channel: COPILOT,
    sessionKey: `vscode:s-${date}-${index}`,
    cost: costs({ billed: billed(10 * ratio), priced: priced(10, VERSION, "AI_CREDITS") }),
    ...overrides,
  }));
}

const detector = new PriceChangeDetector();

describe("PriceChangeDetector.observed", () => {
  it("finds a run of two weeks billed more than 5% above the price book, with its evidence", () => {
    const changes = detector.observed([
      ...turns("2026-10-06", 30, 1.0), // W41: as priced
      ...turns("2026-10-13", 25, 1.12), // W42: 12% above
      ...turns("2026-10-20", 20, 1.12), // W43: 12% above
    ]);
    expect(changes).toHaveLength(1);
    const change = observedPriceChangeSchema.parse(changes[0]);
    expect(change).toMatchObject({
      kind: "observed",
      date: "2026-10-12",
      channel: COPILOT,
      modelId: "claude-sonnet-5.5",
      direction: "above",
      percent: 12,
      priceVersionIds: [VERSION],
      confidence: "inferred",
    });
    expect(change.weeks.map((week) => [week.period, week.start, week.end, week.turns])).toEqual([
      ["2026-W42", "2026-10-12", "2026-10-18", 25],
      ["2026-W43", "2026-10-19", "2026-10-25", 20],
    ]);
    expect(change.weeks[0]).toMatchObject({ billedAiCredits: 280, pricedAiCredits: 250, ratio: 1.12 });
  });

  it("finds a gap below the price book as well", () => {
    const [change] = detector.observed([...turns("2026-10-13", 20, 0.9), ...turns("2026-10-20", 20, 0.9)]);
    expect(change).toMatchObject({ direction: "below", percent: -10 });
  });

  it("needs two weeks in a row: one week, or two weeks with a gap between, is not a change", () => {
    expect(detector.observed(turns("2026-10-13", 40, 1.2))).toEqual([]);
    expect(detector.observed([...turns("2026-10-06", 20, 1.2), ...turns("2026-10-20", 20, 1.2)])).toEqual([]);
  });

  it("needs the same direction both weeks", () => {
    expect(detector.observed([...turns("2026-10-13", 20, 1.2), ...turns("2026-10-20", 20, 0.8)])).toEqual([]);
  });

  it("ignores gaps of 5% or less and weeks with fewer than 20 compared turns", () => {
    expect(detector.observed([...turns("2026-10-13", 20, 1.05), ...turns("2026-10-20", 20, 1.05)])).toEqual([]);
    expect(detector.observed([...turns("2026-10-13", 19, 1.2), ...turns("2026-10-20", 20, 1.2)])).toEqual([]);
  });

  it("compares only turns with both figures in AI Credits (constraint 6: never an unknown as 0)", () => {
    const unpriced = turns("2026-10-13", 30, 1.2, { cost: costs({ billed: billed(12) }) });
    const unbilled = turns("2026-10-20", 30, 1.2, { cost: costs({ priced: priced(10, VERSION, "AI_CREDITS") }) });
    expect(detector.observed([...unpriced, ...unbilled, ...turns("2026-10-13", 10, 1.2), ...turns("2026-10-20", 20, 1.2)])).toEqual([]);
  });

  it("keeps models and channels apart, and splits two separate runs", () => {
    const other = { model: "gpt-5.5" };
    const changes = detector.observed([
      ...turns("2026-09-08", 20, 1.2),
      ...turns("2026-09-15", 20, 1.2),
      ...turns("2026-09-22", 20, 1.0),
      ...turns("2026-09-29", 20, 0.8),
      ...turns("2026-10-06", 20, 0.8),
      ...turns("2026-10-13", 20, 1.2, other),
      ...turns("2026-10-20", 20, 1.2, other),
    ]);
    expect(changes.map((change) => [change.modelId, change.date, change.direction])).toEqual([
      ["claude-sonnet-5.5", "2026-09-07", "above"],
      ["claude-sonnet-5.5", "2026-09-28", "below"],
      ["gpt-5.5", "2026-10-12", "above"],
    ]);
  });

  it("keeps changes starting inside the inclusive range", () => {
    const all = [...turns("2026-10-13", 20, 1.2), ...turns("2026-10-20", 20, 1.2)];
    expect(detector.observed(all, { since: "2026-10-13" })).toEqual([]);
    expect(detector.observed(all, { since: "2026-10-12", until: "2026-10-12" })).toHaveLength(1);
    expect(detector.observed(all, { pairs: [{ channel: COPILOT, modelId: "gpt-5.5" }] })).toEqual([]);
  });
});

describe("PriceChangeDetector.list", () => {
  const before: PriceBookEntry = {
    id: VERSION,
    channel: COPILOT,
    modelId: "claude-sonnet-5.5",
    currency: "USD",
    effectiveFrom: "2026-10-01",
    effectiveTo: "2026-10-07",
    tiers: [{ inputUsdPerM: 3, cachedInputUsdPerM: 0.3, cacheWriteUsdPerM: 3.75, outputUsdPerM: 15 }],
    kind: "list",
    sourceIds: ["s1"],
    origin: "bundled",
  };
  const after: PriceBookEntry = { ...before, id: "github-copilot:claude-sonnet-5.5:2026-10-07", effectiveFrom: "2026-10-07", effectiveTo: undefined, tiers: [{ ...before.tiers[0]!, cachedInputUsdPerM: 0.15 }], sourceIds: ["s2"] };
  const observedTurns = [...turns("2026-10-13", 20, 1.2), ...turns("2026-10-20", 20, 1.2)];

  it("lists documented and observed changes, oldest first, filtered by kind, model and channel", () => {
    const all = detector.list({ versions: [before, after], turns: observedTurns });
    expect(all.map((change) => [change.kind, change.date])).toEqual([
      ["documented", "2026-10-07"],
      ["observed", "2026-10-12"],
    ]);
    expect(detector.list({ versions: [before, after], turns: observedTurns }, { kind: "documented" }).map((change) => change.kind)).toEqual(["documented"]);
    expect(detector.list({ versions: [before, after], turns: observedTurns }, { kind: "observed" }).map((change) => change.kind)).toEqual(["observed"]);
    expect(detector.list({ versions: [before, after], turns: observedTurns }, { model: "gpt-5.5" })).toEqual([]);
    expect(detector.list({ versions: [before, after], turns: observedTurns }, { channel: "openai-api" })).toEqual([]);
  });
});
