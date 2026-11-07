// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { isWithinTolerance, nextGroupFraction } from "./panel-width.js";

describe("nextGroupFraction (check 1.9)", () => {
  it("scales the editor group's share of the editor area by target over measured", () => {
    expect(nextGroupFraction(1, 1500, 750)).toBeCloseTo(0.5);
    expect(nextGroupFraction(0.5, 800, 400)).toBeCloseTo(0.25);
  });

  it("grows the share when the panel is too narrow", () => {
    expect(nextGroupFraction(0.2, 300, 360)).toBeCloseTo(0.24);
  });

  it("stays within what an editor layout accepts", () => {
    expect(nextGroupFraction(1, 1500, 5000)).toBe(0.95);
    expect(nextGroupFraction(0.1, 1000, 10)).toBe(0.05);
  });

  it("refuses a measurement of zero", () => {
    expect(() => nextGroupFraction(0.5, 0, 360)).toThrow(/not measured/);
  });
});

describe("isWithinTolerance", () => {
  it("accepts the target and 8 px either side", () => {
    expect(isWithinTolerance(640, 640)).toBe(true);
    expect(isWithinTolerance(632, 640)).toBe(true);
    expect(isWithinTolerance(648, 640)).toBe(true);
  });

  it("rejects beyond", () => {
    expect(isWithinTolerance(631, 640)).toBe(false);
    expect(isWithinTolerance(649, 640)).toBe(false);
  });
});
