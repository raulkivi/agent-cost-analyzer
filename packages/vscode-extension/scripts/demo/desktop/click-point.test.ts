// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { clickPoint } from "./click-point.mts";

describe("clickPoint", () => {
  const match = { x: 100, y: 200, width: 40, height: 20, score: 0.95 };
  it("returns the centre of a confident match", () => {
    expect(clickPoint(match)).toEqual({ x: 120, y: 210 });
  });
  it("returns undefined below the default 0.9 threshold", () => {
    expect(clickPoint({ ...match, score: 0.89 })).toBeUndefined();
  });
  it("accepts a score equal to the threshold", () => {
    expect(clickPoint({ ...match, score: 0.9 })).toEqual({ x: 120, y: 210 });
  });
  it("honours a custom threshold", () => {
    expect(clickPoint({ ...match, score: 0.8 }, 0.75)).toEqual({ x: 120, y: 210 });
  });
  it("rounds odd sizes down to a whole pixel", () => {
    expect(clickPoint({ x: 0, y: 0, width: 21, height: 21, score: 1 })).toEqual({ x: 10, y: 10 });
  });
});
