// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { sumCostFigures, type CostFigure } from "./cost-figure.js";
import { addCostTotals, bucketOf, bucketsBetween, comparisonPeriod, costInCurrency } from "./cost-analysis.js";

// Phase 15 step 15.7 (plan §8.1, §8.2, §13 D2/D6): the pure helpers behind
// the time series and compare builders. Buckets are UTC; weeks are ISO.

const credits = (amount: number): CostFigure => ({ known: true, amount, currency: "AI_CREDITS", basis: "billed" });
const usd = (amount: number): CostFigure => ({ known: true, amount, currency: "USD", basis: "priced", apiEquivalent: true, priceVersionIds: ["v"] });
const unknown: CostFigure = { known: false, reason: "no price" };

describe("bucketOf", () => {
  it("keys a day, an ISO week and a calendar month, with inclusive start and end dates", () => {
    expect(bucketOf("2026-10-07", "day")).toEqual({ period: "2026-10-07", start: "2026-10-07", end: "2026-10-07" });
    expect(bucketOf("2026-10-07", "week")).toEqual({ period: "2026-W41", start: "2026-10-05", end: "2026-10-11" });
    expect(bucketOf("2026-10-07", "month")).toEqual({ period: "2026-10", start: "2026-10-01", end: "2026-10-31" });
    expect(bucketOf("2028-02-10", "month").end).toBe("2028-02-29");
  });

  it("puts the days around New Year in the ISO week-year they belong to", () => {
    expect(bucketOf("2027-01-01", "week")).toEqual({ period: "2026-W53", start: "2026-12-28", end: "2027-01-03" });
    expect(bucketOf("2025-12-29", "week")).toEqual({ period: "2026-W01", start: "2025-12-29", end: "2026-01-04" });
  });
});

describe("bucketsBetween", () => {
  it("lists every bucket that touches the range, in order", () => {
    expect(bucketsBetween("2026-09-30", "2026-11-01", "month").map((b) => b.period)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(bucketsBetween("2026-10-04", "2026-10-13", "week").map((b) => b.period)).toEqual(["2026-W40", "2026-W41", "2026-W42"]);
    expect(bucketsBetween("2026-10-30", "2026-11-01", "day").map((b) => b.period)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(bucketsBetween("2026-10-02", "2026-10-01", "day")).toEqual([]);
  });
});

describe("costInCurrency", () => {
  const total = sumCostFigures([credits(50), usd(1.5), unknown]);

  it("leaves a native total as it is", () => {
    expect(costInCurrency(total, "native")).toEqual(total);
  });

  it("states a usd total as one USD amount at 1 AI Credit = $0.01", () => {
    expect(costInCurrency(total, "usd")).toEqual({ ...total, amounts: [{ currency: "USD", amount: 2, knownTurns: 2 }] });
  });

  it("keeps an all-unknown total unknown in USD too, never 0", () => {
    const none = sumCostFigures([unknown]);
    expect(costInCurrency(none, "usd")).toMatchObject({ amounts: [], usd: null, knownTurns: 0, turns: 1 });
  });
});

describe("addCostTotals", () => {
  it("adds per currency and keeps unknown as null", () => {
    const a = sumCostFigures([credits(1), unknown]);
    const b = sumCostFigures([usd(2)]);
    expect(addCostTotals(a, b)).toEqual(sumCostFigures([credits(1), unknown, usd(2)]));
    expect(addCostTotals(sumCostFigures([unknown]), sumCostFigures([]))).toMatchObject({ usd: null, turns: 1, knownTurns: 0 });
  });
});

describe("comparisonPeriod", () => {
  it("is the same number of days just before the period", () => {
    expect(comparisonPeriod("2026-10-01", "2026-10-31", "previous")).toEqual({ since: "2026-08-31", until: "2026-09-30" });
  });

  it("is the same dates a year earlier, 29 February becoming the 28th", () => {
    expect(comparisonPeriod("2026-10-01", "2026-10-31", "last-year")).toEqual({ since: "2025-10-01", until: "2025-10-31" });
    expect(comparisonPeriod("2028-02-29", "2028-03-01", "last-year")).toEqual({ since: "2027-02-28", until: "2027-03-01" });
  });
});
