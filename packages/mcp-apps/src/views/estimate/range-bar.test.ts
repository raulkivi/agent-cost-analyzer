// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { niceMax, rangeBar } from "./range-bar.js";

describe("niceMax", () => {
  it.each([
    [164, 200],
    [355, 500],
    [210, 250],
    [95, 100],
    [100, 100],
    [0.7, 1],
    [0, 1],
  ])("%d -> %d", (value, max) => {
    expect(niceMax(value)).toBe(max);
  });
});

describe("rangeBar", () => {
  it("places p50 and p90 on a 0 to max scale", () => {
    expect(rangeBar(98, 164)).toEqual({ max: 200, startPercent: 49, endPercent: 82 });
  });

  it("keeps p90 inside the scale", () => {
    expect(rangeBar(10, 500).endPercent).toBeLessThanOrEqual(100);
  });
});
