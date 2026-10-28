import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { layoutFor } from "./layout.js";

// The layout order: a wider room never gets a narrower layout.
const RANK = { narrow: 0, medium: 1, wide: 2 } as const;

const widthArb = fc.integer({ min: 1, max: 5000 });
const optionsArb = fc.boolean().map((listColumn) => ({ listColumn }));

describe("layoutFor (properties)", () => {
  it("never gives a narrower layout to a wider room (monotonic)", () => {
    fc.assert(
      fc.property(widthArb, widthArb, optionsArb, (w1, w2, options) => {
        const [a, b] = w1 <= w2 ? [w1, w2] : [w2, w1];
        expect(RANK[layoutFor(a, options)]).toBeLessThanOrEqual(RANK[layoutFor(b, options)]);
      }),
    );
  });

  it("never makes the layout wider just because the session list column is there", () => {
    fc.assert(
      fc.property(widthArb, (width) => {
        expect(RANK[layoutFor(width, { listColumn: true })]).toBeLessThanOrEqual(
          RANK[layoutFor(width, { listColumn: false })],
        );
      }),
    );
  });

  it("lays every width out as one of the three layouts, and 5000 px is wide", () => {
    fc.assert(
      fc.property(optionsArb, (options) => {
        expect(RANK[layoutFor(5000, options)]).toBe(RANK.wide);
      }),
    );
    fc.assert(
      fc.property(widthArb, optionsArb, (width, options) => {
        expect(Object.keys(RANK)).toContain(layoutFor(width, options));
      }),
    );
  });

  it("treats an unmeasured width (undefined, or 0 before layout) as wide", () => {
    for (const listColumn of [true, false]) {
      expect(layoutFor(undefined, { listColumn })).toBe("wide");
      expect(layoutFor(0, { listColumn })).toBe("wide");
    }
  });
});
