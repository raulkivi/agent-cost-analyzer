// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costRollup } from "../../view-models/fixtures.js";
import { parseCostRollup } from "./parse-rollup.js";

describe("parseCostRollup", () => {
  it("accepts a get_cost_rollup result", () => {
    const rollup = costRollup();
    expect(parseCostRollup(rollup)).toBe(rollup);
  });

  it.each([undefined, null, "text", 3, {}, { topSessions: [] }, { ...costRollup(), daily: undefined }, { ...costRollup(), totals: null }])("rejects %j", (value) => {
    expect(parseCostRollup(value)).toBeUndefined();
  });
});
