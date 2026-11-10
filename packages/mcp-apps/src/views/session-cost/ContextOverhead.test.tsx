// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ContextOverheadView, MeasureView } from "../../view-models/index.js";
import { ContextOverhead } from "./ContextOverhead.js";

const measure = (text: string): MeasureView => ({ text, known: true, estimate: false });

const overheadOf = (components: { label: string; value: number }[]): ContextOverheadView => {
  const total = components.reduce((sum, component) => sum + component.value, 0);
  return {
    systemPrompt: {
      tokens: measure(`${total} tokens`),
      value: total,
      components: components.map((component) => ({
        label: component.label,
        tokens: measure(`${component.value} tokens`),
        value: component.value,
      })),
    },
  };
};

const segmentBackgrounds = (overhead: ContextOverheadView): string[] => {
  const { container } = render(<ContextOverhead overhead={overhead} />);
  const spans = Array.from(container.querySelectorAll<HTMLSpanElement>(".view-stack > span"));
  return spans.map((span) => span.style.background);
};

describe("ContextOverhead colours", () => {
  it("colours a single segment with the chart's data accent", () => {
    const backgrounds = segmentBackgrounds(overheadOf([{ label: "Instructions", value: 1000 }]));
    expect(backgrounds).toEqual(["var(--brand-accent)"]);
  });

  it("colours the second segment differently from the first", () => {
    const [first, second] = segmentBackgrounds(
      overheadOf([
        { label: "Instructions", value: 600 },
        { label: "Tools", value: 400 },
      ]),
    );
    expect(first).toBe("var(--brand-accent)");
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });
});
