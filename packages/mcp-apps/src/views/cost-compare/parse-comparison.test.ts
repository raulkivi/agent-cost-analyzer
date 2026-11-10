// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { comparisonRow, costComparison } from "../../view-models/cost-analysis-fixtures.js";
import { hasNothingToCompare, parseComparison } from "./parse-comparison.js";

describe("parseComparison", () => {
  it("accepts a compare_costs result", () => {
    const result = costComparison();
    expect(parseComparison(result)).toBe(result);
  });

  it.each([
    undefined,
    null,
    "text",
    3,
    {},
    { ...costComparison(), rows: undefined },
    { ...costComparison(), rows: "x" },
    { ...costComparison(), total: null },
    { ...costComparison(), providers: undefined },
    { ...costComparison(), groupBy: 3 },
    { ...costComparison(), previousSince: undefined },
    { ...costComparison(), rows: [null] },
    { ...costComparison(), rows: [{ key: "k" }] },
  ])("rejects %j", (value) => {
    expect(parseComparison(value)).toBeUndefined();
  });
});

describe("hasNothingToCompare", () => {
  const idle = (key: string) => comparisonRow({ key, label: key, turns: 0, sessions: 0, previous: { ...comparisonRow().previous, turns: 0, sessions: 0 } });

  it("is true for no rows", () => {
    expect(hasNothingToCompare(costComparison({ rows: [] }))).toBe(true);
  });

  it("is true when no row has a turn in either period", () => {
    expect(hasNothingToCompare(costComparison({ rows: [idle("a"), idle("b")] }))).toBe(true);
  });

  it("is false when any row has a turn in the period or the one before", () => {
    expect(hasNothingToCompare(costComparison({ rows: [idle("a"), comparisonRow()] }))).toBe(false);
    expect(hasNothingToCompare(costComparison({ rows: [idle("a"), { ...idle("b"), previous: comparisonRow().previous }] }))).toBe(false);
  });
});
