// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { estimate, refusedEstimate } from "../../view-models/increment3-fixtures.js";
import { parseCostEstimate } from "./parse-estimate.js";

describe("parseCostEstimate", () => {
  it("accepts a range and a refusal", () => {
    expect(parseCostEstimate(estimate())).toBeDefined();
    expect(parseCostEstimate(refusedEstimate())).toBeDefined();
  });

  it.each([undefined, null, {}, { label: "forecast" }, { ...estimate(), range: { p50: "9" } }, { ...estimate(), unit: "weeks" }])("rejects %j", (value) => {
    expect(parseCostEstimate(value)).toBeUndefined();
  });
});
