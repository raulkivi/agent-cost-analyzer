import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Waterfall } from "./Waterfall.js";
import type { WaterfallStep } from "../lib/cost/project-model.js";

// Phase 15 step 15.10 (plan §11.4; board 3): the price-versus-usage
// waterfall. Each step carries its signed amount as text, increases and
// decreases use the diverging pair plus the sign (never colour alone), and
// "View as table" gives the same figures.

const steps: WaterfallStep[] = [
  { key: "a", label: "Aug 2026", kind: "total", value: 18240, from: 0, to: 18240 },
  { key: "usage", label: "Usage", kind: "increase", value: 4130, from: 18240, to: 22370 },
  { key: "price", label: "Price", kind: "decrease", value: -1860, from: 22370, to: 20510 },
  { key: "mix", label: "Mix", kind: "increase", value: 610, from: 20510, to: 21120 },
  { key: "b", label: "Oct 2026", kind: "total", value: 21120, from: 0, to: 21120 },
];

function renderChart() {
  return render(<Waterfall ariaLabel="Why cost changed: Aug 2026 to Oct 2026" steps={steps} unit="AI_CREDITS" />);
}

describe("Waterfall", () => {
  it("names the whole walk in the image's accessible name", () => {
    renderChart();
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Why cost changed: Aug 2026 to Oct 2026. Aug 2026 18,240.00, usage +4,130.00, price −1,860.00, mix +610.00, Oct 2026 21,120.00 AI Credits.",
    );
  });

  it("draws one bar per step, marking increases and decreases, each labelled with its signed amount", () => {
    const { container } = renderChart();
    const bars = [...container.querySelectorAll("rect[data-step]")];
    expect(bars.map((bar) => [bar.getAttribute("data-step"), bar.getAttribute("data-kind")])).toEqual([
      ["a", "total"],
      ["usage", "increase"],
      ["price", "decrease"],
      ["mix", "increase"],
      ["b", "total"],
    ]);
    const labels = [...container.querySelectorAll("text[data-value]")].map((text) => text.textContent);
    expect(labels).toEqual(["18,240.00", "+4,130.00", "−1,860.00", "+610.00", "21,120.00"]);
  });

  it("floats an effect between the levels it moves between", () => {
    const { container } = renderChart();
    const usage = container.querySelector('rect[data-step="usage"]')!;
    const price = container.querySelector('rect[data-step="price"]')!;
    // The usage bar's top is price's top: both meet at 22,370.
    expect(usage.getAttribute("y")).toBe(price.getAttribute("y"));
  });

  it("gives the same figures as a table, with the effects summing to the change", async () => {
    renderChart();
    await userEvent.click(screen.getByRole("button", { name: "View as table" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").map((row) => row.textContent)).toEqual([
      "StepAI Credits",
      "Aug 202618,240.00",
      "Usage+4,130.00",
      "Price−1,860.00",
      "Mix+610.00",
      "Oct 202621,120.00",
    ]);
  });
});
