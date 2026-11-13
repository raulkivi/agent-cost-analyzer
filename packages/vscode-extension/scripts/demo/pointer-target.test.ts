// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { glidePath, targetPoint } from "./pointer-target.mts";

describe("targetPoint", () => {
  it("is the centre of the element with no offsets", () => {
    expect(targetPoint({ x: 10, y: 20, width: 100, height: 40 }, [])).toEqual({ x: 60, y: 40 });
  });
  it("adds the sum of the frame offsets", () => {
    expect(
      targetPoint({ x: 0, y: 0, width: 10, height: 10 }, [
        { x: 100, y: 50 },
        { x: 3, y: -2 },
      ]),
    ).toEqual({ x: 108, y: 53 });
  });
  it("accepts zero offsets", () => {
    expect(targetPoint({ x: 0, y: 0, width: 0, height: 0 }, [{ x: 0, y: 0 }])).toEqual({ x: 0, y: 0 });
  });
});

describe("glidePath", () => {
  it("returns just the destination for one step", () => {
    expect(glidePath({ x: 0, y: 0 }, { x: 40, y: 20 }, 1)).toEqual([{ x: 40, y: 20 }]);
  });
  it("returns the requested number of integer points ending exactly on the target", () => {
    const p = glidePath({ x: 0, y: 0 }, { x: 101, y: 33 }, 10);
    expect(p).toHaveLength(10);
    expect(p[9]).toEqual({ x: 101, y: 33 });
    for (const q of p) {
      expect(Number.isInteger(q.x)).toBe(true);
      expect(Number.isInteger(q.y)).toBe(true);
    }
  });
  it("eases in and out: small first and last strides, larger in the middle", () => {
    const p = glidePath({ x: 0, y: 0 }, { x: 1000, y: 0 }, 20);
    const strides = p.map((q, i) => q.x - (i === 0 ? 0 : p[i - 1].x));
    expect(strides[0]).toBeLessThan(strides[10]);
    expect(strides[19]).toBeLessThan(strides[10]);
  });
  it("never moves backwards on a monotone path", () => {
    const p = glidePath({ x: 5, y: 5 }, { x: 500, y: 5 }, 15);
    for (let i = 1; i < p.length; i++) expect(p[i].x).toBeGreaterThanOrEqual(p[i - 1].x);
  });
  it("handles from equal to target", () => {
    expect(glidePath({ x: 7, y: 7 }, { x: 7, y: 7 }, 3)).toEqual([
      { x: 7, y: 7 },
      { x: 7, y: 7 },
      { x: 7, y: 7 },
    ]);
  });
  it("rejects steps below 1 or non-integer", () => {
    expect(() => glidePath({ x: 0, y: 0 }, { x: 1, y: 1 }, 0)).toThrow();
    expect(() => glidePath({ x: 0, y: 0 }, { x: 1, y: 1 }, 1.5)).toThrow();
  });
});
