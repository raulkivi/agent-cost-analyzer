// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costEstimateSchema, MIN_ESTIMATE_UNITS, percentile, type CostEstimate } from "./cost-estimate.js";

// Phase 15 step 15.12 (plan §8.6, D16–D18): an estimate is a labelled
// p50–p90 range at today's prices, never a single number, or no range with
// the reason when the history is too thin.

const base: CostEstimate = {
  label: "estimate",
  generatedAt: "2026-11-06T12:00:00.000Z",
  target: { groupBy: "project", id: "portal", name: "Customer portal" },
  pricing: "today",
  currency: "USD",
  conversion: "Every amount is in USD: AI Credits converted at 1 AI Credit = $0.01.",
  window: { weeks: 12, since: "2026-08-15", until: "2026-11-06" },
  unit: "activeDays",
  planned: 20,
  history: { units: 7, knownUnits: 6, turns: 30, totalUsd: 62.4 },
  runRate: { perActiveDayUsd: 10.4, perWeekUsd: 5.2 },
  unitCost: { p50: 10.4, p90: 13.7 },
  range: { p50: 208, p90: 274 },
};

describe("costEstimateSchema", () => {
  it("accepts a range with the unit costs, run rate, window and coverage it came from", () => {
    expect(costEstimateSchema.parse(base)).toEqual(base);
  });

  it("is always labelled an estimate, at today's prices", () => {
    expect(() => costEstimateSchema.parse({ ...base, label: "actual" })).toThrow();
    expect(() => costEstimateSchema.parse({ ...base, pricing: "as-of-use" })).toThrow();
  });

  it("has a range with both ends, p50 not above p90, or no range with the reason (D18)", () => {
    expect(() => costEstimateSchema.parse({ ...base, range: { p50: 300, p90: 274 } })).toThrow();
    const thin = { ...base, unitCost: null, range: null, refusal: "Only 3 active days with a known cost; an estimate needs 5." };
    expect(costEstimateSchema.parse(thin).range).toBeNull();
    expect(() => costEstimateSchema.parse({ ...base, range: null, unitCost: null })).toThrow(/reason/);
    expect(() => costEstimateSchema.parse({ ...base, refusal: "x" })).toThrow(/reason/);
  });

  it("needs five known units", () => {
    expect(MIN_ESTIMATE_UNITS).toBe(5);
  });
});

describe("percentile (linear interpolation)", () => {
  it("gives the median and the 90th percentile of a sample", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([5, 1, 4, 2, 3], 0.9)).toBeCloseTo(4.6, 10);
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([7], 0.9)).toBe(7);
  });
});
