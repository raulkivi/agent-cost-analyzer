import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor, readableTextOn, resolveCssColor } from "./contrast.js";

describe("contrast (WCAG 2.2 relative luminance)", () => {
  it("parses #rgb, #rrggbb and the named colours the theme uses", () => {
    expect(parseColor("#ffffff")).toEqual([255, 255, 255]);
    expect(parseColor("#FFF")).toEqual([255, 255, 255]);
    expect(parseColor("#1d1f20")).toEqual([29, 31, 32]);
    expect(parseColor("white")).toEqual([255, 255, 255]);
    expect(parseColor("black")).toEqual([0, 0, 0]);
  });

  it("rejects what it can't read rather than guessing", () => {
    expect(() => parseColor("rebeccapurple")).toThrow(/rebeccapurple/);
  });

  it("gives the WCAG reference ratios", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    // #777 on white is the classic just-under-AA grey.
    expect(contrastRatio(parseColor("#777777"), parseColor("#ffffff"))).toBeCloseTo(4.48, 2);
  });

  it("is symmetric", () => {
    const a = parseColor("#5980a6");
    const b = parseColor("#f2f2f3");
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  describe("resolveCssColor", () => {
    const vars = { "--ink": "#000000", "--paper": "#ffffff", "--alias": "var(--ink)" };

    it("resolves custom properties, nested ones and var() fallbacks", () => {
      expect(resolveCssColor("var(--alias)", { vars })).toEqual([0, 0, 0]);
      expect(resolveCssColor("var(--vscode-missing, #ff0000)", { vars })).toEqual([255, 0, 0]);
      expect(resolveCssColor("var(--vscode-missing, var(--paper))", { vars })).toEqual([255, 255, 255]);
    });

    it("mixes two colours in sRGB by percentage", () => {
      expect(resolveCssColor("color-mix(in srgb, #000000 25%, white)", { vars })).toEqual([191.25, 191.25, 191.25]);
    });

    it("composites a mix with transparent over the backdrop it's drawn on", () => {
      expect(resolveCssColor("color-mix(in srgb, var(--ink) 60%, transparent)", { vars, backdrop: [255, 255, 255] })).toEqual([
        102, 102, 102,
      ]);
    });

    it("needs a backdrop for anything transparent", () => {
      expect(() => resolveCssColor("color-mix(in srgb, #000 60%, transparent)", { vars })).toThrow(/backdrop/);
    });
  });

  describe("readableTextOn", () => {
    it("picks dark text on light fills and white text on dark fills, whichever contrasts more", () => {
      expect(readableTextOn("#eda100")).toBe("#000000");
      expect(readableTextOn("#4a3aa7")).toBe("#ffffff");
      expect(readableTextOn("color-mix(in srgb, #4a3aa7 38%, white)")).toBe("#000000");
    });
  });
});
