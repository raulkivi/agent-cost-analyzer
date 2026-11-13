// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  ALLOWANCE_SETTING_IDS,
  DEFAULT_RESET_DAY,
  DEFAULT_WARN_AT_PERCENT,
  readAllowanceSettings,
} from "./allowance-settings.js";

const reader = (values: Record<string, unknown>) => ({ get: (id: string) => values[id] });
const withValue = (key: keyof typeof ALLOWANCE_SETTING_IDS, value: unknown) => readAllowanceSettings(reader({ [ALLOWANCE_SETTING_IDS[key]]: value }));

describe("readAllowanceSettings", () => {
  it("names the three settings", () => {
    expect(ALLOWANCE_SETTING_IDS).toEqual({
      aiCredits: "aiCreditsAnalyzer.monthlyAllowance.aiCredits",
      resetDay: "aiCreditsAnalyzer.monthlyAllowance.resetDay",
      warnAtPercent: "aiCreditsAnalyzer.monthlyAllowance.warnAtPercent",
    });
  });

  it("is not set, with the defaults, when nothing is configured", () => {
    expect(readAllowanceSettings(reader({}))).toEqual({ aiCredits: null, resetDay: 1, warnAtPercent: 80 });
    expect([DEFAULT_RESET_DAY, DEFAULT_WARN_AT_PERCENT]).toEqual([1, 80]);
  });

  it("reads valid values, an allowance with decimals included", () => {
    const values = readAllowanceSettings(
      reader({
        [ALLOWANCE_SETTING_IDS.aiCredits]: 1000.5,
        [ALLOWANCE_SETTING_IDS.resetDay]: 15,
        [ALLOWANCE_SETTING_IDS.warnAtPercent]: 90,
      }),
    );

    expect(values).toEqual({ aiCredits: 1000.5, resetDay: 15, warnAtPercent: 90 });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "1000"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative", -5],
    ["0", 0],
    ["a boolean", true],
    ["an object", {}],
  ])("treats an allowance of %s as not set", (_label, value) => {
    expect(withValue("aiCredits", value).aiCredits).toBeNull();
  });

  it.each([
    ["0", 0],
    ["29", 29],
    ["-1", -1],
    ["a fraction", 1.5],
    ["a string", "5"],
    ["NaN", Number.NaN],
    ["null", null],
  ])("falls back to reset day 1 for %s", (_label, value) => {
    expect(withValue("resetDay", value).resetDay).toBe(1);
  });

  it("accepts the reset day bounds 1 and 28", () => {
    expect(withValue("resetDay", 1).resetDay).toBe(1);
    expect(withValue("resetDay", 28).resetDay).toBe(28);
  });

  it.each([
    ["0", 0],
    ["101", 101],
    ["-1", -1],
    ["a fraction", 80.5],
    ["a string", "80"],
    ["NaN", Number.NaN],
    ["null", null],
  ])("falls back to a warning at 80 percent for %s", (_label, value) => {
    expect(withValue("warnAtPercent", value).warnAtPercent).toBe(80);
  });

  it("accepts the warn percent bounds 1 and 100", () => {
    expect(withValue("warnAtPercent", 1).warnAtPercent).toBe(1);
    expect(withValue("warnAtPercent", 100).warnAtPercent).toBe(100);
  });

  it("reads through on every call, so a changed setting shows at once", () => {
    const values: Record<string, unknown> = { [ALLOWANCE_SETTING_IDS.aiCredits]: 100 };
    const config = reader(values);

    expect(readAllowanceSettings(config).aiCredits).toBe(100);
    values[ALLOWANCE_SETTING_IDS.aiCredits] = 200;
    expect(readAllowanceSettings(config).aiCredits).toBe(200);
  });
});
