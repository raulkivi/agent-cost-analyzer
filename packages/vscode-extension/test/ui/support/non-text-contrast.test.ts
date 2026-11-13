// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { judgeNonTextContrast } from "./non-text-contrast.js";

const WHITE = "rgb(255, 255, 255)";

describe("judgeNonTextContrast (step 10.19, WCAG 1.4.11)", () => {
  it("accepts a paint that reaches 3:1 on its ground", () => {
    expect(judgeNonTextContrast([{ label: "marker", paint: "rgb(0, 102, 184)", backgrounds: ["rgba(0, 0, 0, 0)", WHITE] }])).toEqual([]);
  });

  it("names a paint below 3:1 with its ratio", () => {
    const findings = judgeNonTextContrast([{ label: "marker", paint: "rgb(200, 200, 200)", backgrounds: [WHITE] }]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/^marker: 1\.\d+:1 on rgb/);
  });

  it("composites a translucent ground over the ones below it", () => {
    expect(judgeNonTextContrast([{ label: "run", paint: "rgb(0, 0, 0)", backgrounds: ["rgba(0, 0, 0, 0.1)", WHITE] }])).toEqual([]);
  });

  it("flags a colour it cannot read rather than passing it", () => {
    expect(judgeNonTextContrast([{ label: "marker", paint: "none", backgrounds: [WHITE] }])).toEqual(["marker: paint \"none\" is not a colour"]);
  });

  it("flags no samples, so a spec cannot pass without having looked at anything", () => {
    expect(judgeNonTextContrast([])).toEqual(["no samples to judge"]);
  });
});
