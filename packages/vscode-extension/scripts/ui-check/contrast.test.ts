import { describe, expect, it } from "vitest";
import { compositeOver, contrastRatio, parseCssColor } from "./contrast.mts";

describe("parseCssColor", () => {
  it("reads rgb() and rgba() as computed styles report them", () => {
    expect(parseCssColor("rgb(31, 31, 31)")).toEqual({ r: 31, g: 31, b: 31, a: 1 });
    expect(parseCssColor("rgba(0, 120, 212, 0.25)")).toEqual({ r: 0, g: 120, b: 212, a: 0.25 });
  });

  it("reads Chromium's color(srgb …) form for color-mix() results", () => {
    expect(parseCssColor("color(srgb 1 0.5 0 / 0.5)")).toEqual({ r: 255, g: 127.5, b: 0, a: 0.5 });
    expect(parseCssColor("color(srgb 0 0 0)")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("treats transparent and anything unreadable as no colour", () => {
    expect(parseCssColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseCssColor("oklch(0.5 0.1 200)")).toBeNull();
  });
});

describe("compositeOver", () => {
  it("lays a translucent colour over an opaque ground", () => {
    expect(compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 })).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });
});

describe("contrastRatio (WCAG 2)", () => {
  it("is 21 for black on white and 1 for equal colours", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(21, 5);
    expect(contrastRatio({ r: 31, g: 31, b: 31, a: 1 }, { r: 31, g: 31, b: 31, a: 1 })).toBeCloseTo(1, 5);
  });

  it("matches a known pair: VS Code Dark Modern text on its editor (#cccccc on #1f1f1f)", () => {
    expect(contrastRatio({ r: 204, g: 204, b: 204, a: 1 }, { r: 31, g: 31, b: 31, a: 1 })).toBeCloseTo(10.26, 1);
  });
});
