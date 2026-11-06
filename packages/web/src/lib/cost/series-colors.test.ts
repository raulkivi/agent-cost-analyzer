import { describe, expect, it } from "vitest";
import { NEUTRAL_SERIES, seriesStyle, SeriesPalette, VENDOR_ORDER } from "./series-colors.js";

describe("series colours (plan §11.7: fixed order, colour follows the entity)", () => {
  it("gives slot n to the nth entity of the fixed order, with its High Contrast dash", () => {
    expect(seriesStyle(0)).toEqual({ color: "var(--color-series-1)", dash: "var(--dash-series-1)" });
    expect(seriesStyle(7)).toEqual({ color: "var(--color-series-8)", dash: "var(--dash-series-8)" });
  });

  it("never invents a ninth hue: past the eighth, and for unknown buckets, the neutral style", () => {
    expect(seriesStyle(8)).toEqual(NEUTRAL_SERIES);
    const palette = new SeriesPalette(["portal", "billing"]);
    expect(palette.styleFor(null)).toEqual(NEUTRAL_SERIES);
    expect(palette.styleFor("not-in-order")).toEqual(NEUTRAL_SERIES);
  });

  it("keeps an entity's colour when the others are filtered out", () => {
    const palette = new SeriesPalette(["portal", "billing", "tools"]);
    expect(palette.styleFor("tools")).toEqual(seriesStyle(2));
    expect(palette.styleFor("billing")).toEqual(seriesStyle(1));
  });

  it("orders vendors as the plan does", () => {
    expect(VENDOR_ORDER.slice(0, 3)).toEqual(["anthropic", "openai", "google"]);
  });
});
