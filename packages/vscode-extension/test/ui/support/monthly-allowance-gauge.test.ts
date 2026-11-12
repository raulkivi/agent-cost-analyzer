// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { isOpaque, parseColor, resetDayFor, usedFrom } from "./monthly-allowance-gauge.js";

describe("parseColor", () => {
  it("reads rgb with spaces, never as transparent", () => {
    expect(parseColor("rgb(122, 100, 0)")).toEqual({ r: 122, g: 100, b: 0, a: 1 });
    expect(isOpaque(parseColor("rgb(122, 100, 0)"), { r: 122, g: 100, b: 0 })).toBe(true);
  });

  it("reads rgba, the transparent default and the space-separated form", () => {
    expect(parseColor("rgba(0, 0, 0, 0)")?.a).toBe(0);
    expect(parseColor("rgb(185 16 7 / 50%)")).toEqual({ r: 185, g: 16, b: 7, a: 0.5 });
  });

  it("gives undefined for something that is not a colour", () => {
    expect(parseColor("transparent")).toBeUndefined();
  });
});

describe("usedFrom", () => {
  it("reads the figure with a thousands separator and an 'at least'", () => {
    expect(usedFrom("AI Credits this month: at least 1,029.40 of 2,000 allowance, 51 percent")).toBe(1029.4);
  });
});

describe("resetDayFor", () => {
  it("is the day three days before the run, at most the 28th", () => {
    expect(resetDayFor(new Date(2026, 10, 13, 12))).toBe(10);
    expect(resetDayFor(new Date(2026, 11, 2, 12))).toBe(28);
    expect(resetDayFor(new Date(2026, 2, 3, 12))).toBe(28);
  });
});
