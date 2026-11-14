// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { savingsOutput } from "../../view-models/savings-fixtures.js";
import { parseSavingsReport } from "./parse-savings.js";

describe("parseSavingsReport", () => {
  it("accepts what get_savings_report returns", () => {
    expect(parseSavingsReport(savingsOutput())?.opportunities).toHaveLength(3);
  });

  it("defaults the optional left-out list", () => {
    expect(parseSavingsReport(savingsOutput())?.sessionsLeftOut).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    "text",
    {},
    { ...savingsOutput(), window: "x" },
    { ...savingsOutput(), opportunities: "x" },
    { ...savingsOutput(), simulated: undefined },
    { ...savingsOutput(), notAnalysed: undefined },
    { ...savingsOutput(), includeSimulated: "yes" },
    { ...savingsOutput(), opportunities: [null] },
    { ...savingsOutput(), opportunities: [{ key: "k" }] },
  ])("rejects %j", (value) => {
    expect(parseSavingsReport(value)).toBeUndefined();
  });
});
