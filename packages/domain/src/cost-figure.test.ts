// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  AI_CREDIT_CONVERSION_NOTE,
  buildCostReconciliation,
  costBasisTotals,
  costBasisTotalsSchema,
  costFigureFor,
  costFigureSchema,
  costReconciliationRowSchema,
  preferredCostFigure,
  sumCostFigures,
  toUsd,
  turnCostFiguresSchema,
  type CostFigure,
  type TurnCostFigures,
} from "./cost-figure.js";

const unknown = (reason: string): CostFigure => ({ known: false, reason });
const billed = (amount: number): CostFigure => ({ known: true, amount, currency: "AI_CREDITS", basis: "billed" });
const reported = (amount: number): CostFigure => ({ known: true, amount, currency: "USD", basis: "reported" });
const priced = (amount: number, currency: "AI_CREDITS" | "USD" = "USD", extra: Partial<CostFigure> = {}): CostFigure =>
  ({ known: true, amount, currency, basis: "priced", priceVersionIds: ["v1"], ...extra }) as CostFigure;

function figures(overrides: Partial<TurnCostFigures> = {}): TurnCostFigures {
  return {
    billed: unknown("no billed figure"),
    reported: unknown("no reported figure"),
    priced: unknown("no price"),
    ...overrides,
  };
}

describe("costFigureSchema", () => {
  it("accepts a known figure with its basis and currency, and an unknown one with a reason", () => {
    expect(costFigureSchema.parse(priced(1.5))).toEqual(priced(1.5));
    expect(costFigureSchema.parse(unknown("why"))).toEqual(unknown("why"));
  });

  it("rejects an unknown figure without a reason (constraint 6: never a bare 0)", () => {
    expect(() => costFigureSchema.parse({ known: false, reason: "" })).toThrow();
    expect(() => costFigureSchema.parse({ known: false })).toThrow();
  });

  it("allows price versions only on a priced figure", () => {
    expect(() => costFigureSchema.parse({ ...billed(1), priceVersionIds: ["v1"] })).toThrow();
  });

  it("rejects a negative amount", () => {
    expect(() => costFigureSchema.parse(billed(-1))).toThrow();
  });

  it("parses the three bases of a turn", () => {
    const value = figures({ billed: billed(2), priced: priced(1.9, "AI_CREDITS") });
    expect(turnCostFiguresSchema.parse(value)).toEqual(value);
  });
});

describe("preferredCostFigure (plan §5, D3)", () => {
  it("takes billed, then reported, then priced", () => {
    expect(preferredCostFigure(figures({ billed: billed(2), reported: reported(3), priced: priced(4) }))).toEqual(billed(2));
    expect(preferredCostFigure(figures({ reported: reported(3), priced: priced(4) }))).toEqual(reported(3));
    expect(preferredCostFigure(figures({ priced: priced(4) }))).toEqual(priced(4));
  });

  it("is unknown with every basis' reason when none is known", () => {
    const preferred = preferredCostFigure(figures());
    expect(preferred.known).toBe(false);
    if (!preferred.known) {
      expect(preferred.reason).toContain("no billed figure");
      expect(preferred.reason).toContain("no reported figure");
      expect(preferred.reason).toContain("no price");
    }
  });

  it("costFigureFor picks one basis for a view", () => {
    const value = figures({ billed: billed(2), priced: priced(4) });
    expect(costFigureFor(value, "priced")).toEqual(priced(4));
    expect(costFigureFor(value, "reported")).toEqual(unknown("no reported figure"));
    expect(costFigureFor(value, "preferred")).toEqual(billed(2));
  });
});

describe("toUsd", () => {
  it("converts AI Credits at 1 AI Credit = $0.01 and keeps USD", () => {
    expect(toUsd(billed(250))).toBeCloseTo(2.5);
    expect(toUsd(reported(1.25))).toBe(1.25);
    expect(toUsd(unknown("x"))).toBeNull();
    expect(AI_CREDIT_CONVERSION_NOTE).toContain("1 AI Credit = $0.01");
  });
});

describe("sumCostFigures", () => {
  it("never sums an unknown figure as 0, and reports coverage", () => {
    const total = sumCostFigures([priced(1), unknown("x"), priced(2)]);
    expect(total).toMatchObject({ turns: 3, knownTurns: 2, usd: 3 });
    expect(total.amounts).toEqual([{ currency: "USD", amount: 3, knownTurns: 2 }]);
  });

  it("is null (not 0) when no figure is known", () => {
    const total = sumCostFigures([unknown("x"), unknown("y")]);
    expect(total).toMatchObject({ turns: 2, knownTurns: 0, usd: null, amounts: [] });
  });

  it("keeps each currency apart and only converts in the usd figure", () => {
    const total = sumCostFigures([billed(100), reported(0.5), billed(50)]);
    expect(total.amounts).toEqual([
      { currency: "AI_CREDITS", amount: 150, knownTurns: 2 },
      { currency: "USD", amount: 0.5, knownTurns: 1 },
    ]);
    expect(total.usd).toBeCloseTo(2);
  });

  it("counts estimated and API-equivalent turns", () => {
    const total = sumCostFigures([priced(1, "USD", { estimated: true }), priced(1, "USD", { apiEquivalent: true })]);
    expect(total.estimated).toBe(true);
    expect(total.apiEquivalentTurns).toBe(1);
  });
});

describe("costBasisTotals", () => {
  const rows = [
    figures({ billed: billed(200), priced: priced(1.8, "AI_CREDITS", { priceVersionIds: ["github-copilot:m:2026-10-01"] }) }),
    figures({ reported: reported(0.3), priced: priced(0.25, "USD", { priceVersionIds: ["anthropic-api:m:2026-10-07"] }) }),
    figures({ priced: priced(0.5, "USD", { priceVersionIds: ["anthropic-api:m:2026-10-07"] }) }),
    figures(),
  ];

  it("totals each basis with its own coverage, and the preferred basis per turn", () => {
    const totals = costBasisTotals(rows);
    expect(totals.billed).toMatchObject({ turns: 4, knownTurns: 1 });
    expect(totals.reported).toMatchObject({ turns: 4, knownTurns: 1 });
    expect(totals.priced).toMatchObject({ turns: 4, knownTurns: 3 });
    expect(totals.preferred).toMatchObject({ turns: 4, knownTurns: 3 });
    expect(totals.preferred.amounts).toEqual([
      { currency: "AI_CREDITS", amount: 200, knownTurns: 1 },
      { currency: "USD", amount: 0.8, knownTurns: 2 },
    ]);
    expect(totals.preferredBasisTurns).toEqual({ billed: 1, reported: 1, priced: 1, unknown: 1 });
  });

  it("lists the price versions used, once each, sorted", () => {
    expect(costBasisTotals(rows).priceVersionIds).toEqual(["anthropic-api:m:2026-10-07", "github-copilot:m:2026-10-01"]);
  });

  it("parses against its schema and states the conversion it uses", () => {
    const totals = costBasisTotals(rows);
    expect(costBasisTotalsSchema.parse(totals)).toEqual(totals);
    expect(totals.conversion).toBe(AI_CREDIT_CONVERSION_NOTE);
  });

  it("has zero turns and null totals for no rows", () => {
    const totals = costBasisTotals([]);
    expect(totals.preferred).toMatchObject({ turns: 0, knownTurns: 0, usd: null });
  });
});

describe("buildCostReconciliation (plan §5: billed vs priced per model and month)", () => {
  const copilot = (month: string, model: string, billedCredits: number, pricedCredits: number | null, version = "v1") => ({
    month,
    model,
    cost: figures({
      billed: billed(billedCredits),
      priced: pricedCredits === null ? unknown("no price") : priced(pricedCredits, "AI_CREDITS", { priceVersionIds: [version] }),
    }),
  });

  it("compares billed and priced AI Credits per model and month", () => {
    const rows = buildCostReconciliation([
      copilot("2026-10", "claude-sonnet-5.5", 110, 100, "a"),
      copilot("2026-10", "claude-sonnet-5.5", 22, 20, "b"),
      copilot("2026-10", "gpt-6-sol", 50, 50),
      copilot("2026-11", "claude-sonnet-5.5", 10, null),
    ]);
    expect(rows).toEqual([
      {
        month: "2026-10",
        model: "claude-sonnet-5.5",
        turns: 2,
        billedAiCredits: 132,
        pricedAiCredits: 120,
        difference: 12,
        ratio: 1.1,
        billedOnlyTurns: 0,
        priceVersionIds: ["a", "b"],
      },
      {
        month: "2026-10",
        model: "gpt-6-sol",
        turns: 1,
        billedAiCredits: 50,
        pricedAiCredits: 50,
        difference: 0,
        ratio: 1,
        billedOnlyTurns: 0,
        priceVersionIds: ["v1"],
      },
      {
        month: "2026-11",
        model: "claude-sonnet-5.5",
        turns: 0,
        billedAiCredits: null,
        pricedAiCredits: null,
        difference: null,
        ratio: null,
        billedOnlyTurns: 1,
        priceVersionIds: [],
      },
    ]);
    for (const row of rows) costReconciliationRowSchema.parse(row);
  });

  it("leaves out turns with no billed AI Credits or no month", () => {
    expect(
      buildCostReconciliation([
        { month: "2026-10", model: "m", cost: figures({ priced: priced(1) }) },
        { month: undefined, model: "m", cost: figures({ billed: billed(1), priced: priced(1, "AI_CREDITS") }) },
      ]),
    ).toEqual([]);
  });

  it("gives no ratio when the priced figure is 0", () => {
    const [row] = buildCostReconciliation([copilot("2026-10", "m", 0, 0)]);
    expect(row!.ratio).toBeNull();
  });
});
