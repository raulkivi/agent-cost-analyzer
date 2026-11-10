// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costVariance } from "../../view-models/cost-analysis-fixtures.js";
import { parseCostVariance } from "./parse-variance.js";

describe("parseCostVariance", () => {
  it("accepts an explain_cost_change result", () => {
    const value = costVariance();
    expect(parseCostVariance(value)).toBe(value);
  });

  it.each([undefined, null, "text", 3, {}, { currencies: [] }])("rejects %j", (value) => {
    expect(parseCostVariance(value)).toBeUndefined();
  });

  it("rejects a result missing the not-explained periods", () => {
    expect(parseCostVariance({ ...costVariance(), notExplained: {} })).toBeUndefined();
  });
});
