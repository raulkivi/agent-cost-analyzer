// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  allowanceSettingsSchema,
  allowanceSettingsWriteSchema,
  DEFAULT_RESET_DAY,
  DEFAULT_WARN_AT_PERCENT,
  lenientAllowanceSettings,
  MAX_ALLOWANCE_AI_CREDITS,
} from "./allowance-settings.js";

const withValue = (key: "aiCredits" | "resetDay" | "warnAtPercent", value: unknown) => lenientAllowanceSettings({ [key]: value });

describe("lenientAllowanceSettings", () => {
  it("is not set, with the defaults, when nothing is configured", () => {
    expect(lenientAllowanceSettings({})).toEqual({ aiCredits: null, resetDay: 1, warnAtPercent: 80 });
    expect([DEFAULT_RESET_DAY, DEFAULT_WARN_AT_PERCENT]).toEqual([1, 80]);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "{\"aiCredits\":1000}"],
    ["a number", 1000],
    ["an array", [1000, 15, 90]],
  ])("is not set, with the defaults, for a value that is no object (%s)", (_label, raw) => {
    expect(lenientAllowanceSettings(raw)).toEqual({ aiCredits: null, resetDay: 1, warnAtPercent: 80 });
  });

  it("reads valid values, an allowance with decimals included", () => {
    expect(lenientAllowanceSettings({ aiCredits: 1000.5, resetDay: 15, warnAtPercent: 90 })).toEqual({ aiCredits: 1000.5, resetDay: 15, warnAtPercent: 90 });
  });

  it("keeps each valid value when another is unusable", () => {
    expect(lenientAllowanceSettings({ aiCredits: 1000, resetDay: 29, warnAtPercent: 90 })).toEqual({ aiCredits: 1000, resetDay: 1, warnAtPercent: 90 });
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

  it("ignores keys it does not know", () => {
    expect(lenientAllowanceSettings({ aiCredits: 50, title: "<img src=x>" })).toEqual({ aiCredits: 50, resetDay: 1, warnAtPercent: 80 });
  });

  it("always returns settings the read schema accepts", () => {
    const raws: unknown[] = [undefined, {}, { aiCredits: -1, resetDay: 0, warnAtPercent: 101 }, { aiCredits: 1e12, resetDay: 28, warnAtPercent: 1 }];

    for (const raw of raws) {
      expect(allowanceSettingsSchema.safeParse(lenientAllowanceSettings(raw)).success).toBe(true);
    }
  });
});

describe("allowanceSettingsWriteSchema (strict: the PUT writes nothing on any problem)", () => {
  const valid = { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 };
  const accepts = (body: unknown) => allowanceSettingsWriteSchema.safeParse(body).success;

  it("accepts a whole, valid object, and null to remove the allowance", () => {
    expect(allowanceSettingsWriteSchema.parse(valid)).toEqual(valid);
    expect(allowanceSettingsWriteSchema.parse({ ...valid, aiCredits: null })).toEqual({ ...valid, aiCredits: null });
    expect(accepts({ aiCredits: 0.01, resetDay: 28, warnAtPercent: 100 })).toBe(true);
    expect(accepts({ ...valid, warnAtPercent: 1 })).toBe(true);
  });

  it("caps the allowance at a sanity limit, not a plan amount", () => {
    expect(MAX_ALLOWANCE_AI_CREDITS).toBe(1_000_000_000);
    expect(accepts({ ...valid, aiCredits: MAX_ALLOWANCE_AI_CREDITS })).toBe(true);
    expect(accepts({ ...valid, aiCredits: MAX_ALLOWANCE_AI_CREDITS + 1 })).toBe(false);
  });

  it.each([
    ["0", 0],
    ["-1", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a numeric string", "1000"],
    ["a boolean", true],
  ])("rejects an allowance of %s", (_label, aiCredits) => {
    expect(accepts({ ...valid, aiCredits })).toBe(false);
  });

  it.each([
    ["0", 0],
    ["29", 29],
    ["a fraction", 1.5],
    ["a numeric string", "5"],
    ["null", null],
  ])("rejects a reset day of %s", (_label, resetDay) => {
    expect(accepts({ ...valid, resetDay })).toBe(false);
  });

  it.each([
    ["0", 0],
    ["101", 101],
    ["a fraction", 80.5],
    ["a numeric string", "80"],
    ["null", null],
  ])("rejects a warn percent of %s", (_label, warnAtPercent) => {
    expect(accepts({ ...valid, warnAtPercent })).toBe(false);
  });

  it("rejects an unknown key and a missing one", () => {
    expect(accepts({ ...valid, extra: 1 })).toBe(false);
    expect(accepts({ aiCredits: 1000, resetDay: 1 })).toBe(false);
    expect(accepts({ resetDay: 1, warnAtPercent: 80 })).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "aiCredits=1000"],
    ["an array", [1000, 1, 80]],
  ])("rejects a body that is no object (%s)", (_label, body) => {
    expect(accepts(body)).toBe(false);
  });
});
