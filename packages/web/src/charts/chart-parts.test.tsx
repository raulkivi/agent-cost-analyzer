// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartLegend, patternFillStyle, patternFor, SERIES_PATTERNS } from "./chart-parts.js";

// Step 10.17 G7 (check 1.8): series that colour alone cannot tell apart carry
// a fill pattern too. The first is solid; every other differs from it and from
// each other.
describe("series patterns", () => {
  it("starts solid and gives each of the five slots its own pattern", () => {
    expect(SERIES_PATTERNS[0]).toBe("solid");
    expect(new Set(SERIES_PATTERNS).size).toBe(SERIES_PATTERNS.length);
    expect(SERIES_PATTERNS).toHaveLength(5);
  });

  it("cycles past the last slot", () => {
    expect(patternFor(5)).toBe(patternFor(0));
    expect(patternFor(1)).toBe(SERIES_PATTERNS[1]);
  });

  it("a solid fill is only the colour; every other pattern layers a distinct hatch over it", () => {
    expect(patternFillStyle("var(--color-series-1)", "solid")).toEqual({ backgroundColor: "var(--color-series-1)" });
    const images = SERIES_PATTERNS.slice(1).map((pattern) => {
      const style = patternFillStyle("var(--color-series-1)", pattern);
      expect(style.backgroundColor).toBe("var(--color-series-1)");
      return style.backgroundImage;
    });
    expect(images.every((image) => typeof image === "string" && image.length > 0)).toBe(true);
    expect(new Set(images).size).toBe(images.length);
  });
});

describe("ChartLegend", () => {
  it("draws each swatch with its series' pattern, beside the text label", () => {
    render(
      <ChartLegend
        items={[
          { id: "a", label: "Succeeded", color: "var(--color-status-success)", pattern: "solid" },
          { id: "b", label: "Failed", color: "var(--color-status-error)", pattern: "diagonal" },
        ]}
      />,
    );
    const [solid, hatched] = screen.getAllByRole("listitem").map((item) => item.querySelector<HTMLElement>(".chart-legend-swatch")!);
    expect(solid!.style.backgroundImage).toBe("");
    expect(hatched!.style.backgroundImage).not.toBe("");
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
