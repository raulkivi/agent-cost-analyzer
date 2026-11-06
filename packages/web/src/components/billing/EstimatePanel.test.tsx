import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleEstimate } from "../../test-support/estimate-sample.js";
import { EstimatePanel } from "./EstimatePanel.js";

// Phase 15 step 15.12 (plan §8.6, §11.5; board 4): the Estimate panel. A
// labelled p50–p90 range on an interval with both ends written, the inputs
// it used, never a single number; no range and the reason when the history
// is thin (D18); the other-model reprice waits for Phase 14 (D17).

const estimate = sampleEstimate;

describe("EstimatePanel (plan §11.5, board 4)", () => {
  it("asks for 20 planned days over 12 weeks first, and shows the range with both ends labelled, never one number", async () => {
    const load = vi.fn().mockResolvedValue(estimate());
    render(<EstimatePanel projectId="portal" loadEstimate={load} />);
    const figure = await screen.findByRole("img", { name: /^Estimate/ });
    expect(load).toHaveBeenCalledWith({ projectId: "portal", activeDays: 20, historyWeeks: 12 }, expect.any(AbortSignal));
    expect(figure).toHaveAccessibleName("Estimate at today's prices: 20,800.00 to 27,400.00 AI Credits ($208.00 to $274.00), p50 to p90.");
    expect(screen.getByText("p50 20,800.00")).toBeInTheDocument();
    expect(screen.getByText("p90 27,400.00")).toBeInTheDocument();
    expect(screen.getByText(/From 6 active days with a known cost, 2026-08-15 to 2026-11-06 \(1 left out\): cost per active day median 1,040.00, p90 1,370.00 AI Credits/)).toBeInTheDocument();
    expect(screen.getByText(/On another model: with Phase 14/)).toBeInTheDocument();
  });

  it("writes both ends as text outside the drawing, so they stay readable at any width and never overlap", async () => {
    const load = vi.fn().mockResolvedValue(estimate({ range: { p50: 208, p90: 212 } }));
    render(<EstimatePanel projectId="portal" loadEstimate={load} />);
    const figure = await screen.findByRole("img", { name: /^Estimate/ });
    const p50 = screen.getByText("p50 20,800.00");
    const p90 = screen.getByText("p90 21,200.00");
    expect(figure.contains(p50)).toBe(false);
    expect(figure.contains(p90)).toBe(false);
    expect(p50.parentElement).toBe(p90.parentElement);
    expect(screen.getByText("AI Credits · $208.00 – $212.00")).toBeInTheDocument();
  });

  it("asks again when the planned days or window change", async () => {
    const user = userEvent.setup();
    const load = vi.fn().mockResolvedValue(estimate());
    render(<EstimatePanel projectId="portal" loadEstimate={load} />);
    await screen.findByRole("img", { name: /^Estimate/ });
    const days = screen.getByRole("spinbutton", { name: "Planned active days" });
    await user.clear(days);
    await user.type(days, "5");
    await user.click(screen.getByRole("radio", { name: "4 weeks" }));
    expect(load).toHaveBeenLastCalledWith({ projectId: "portal", activeDays: 5, historyWeeks: 4 }, expect.any(AbortSignal));
  });

  it("shows the reason instead of a range when the history is thin (D18)", async () => {
    const load = vi.fn().mockResolvedValue(estimate({ range: null, unitCost: null, refusal: "Only 3 active days with a known cost in the last 12 weeks; an estimate needs at least 5." }));
    render(<EstimatePanel projectId="portal" loadEstimate={load} />);
    expect(await screen.findByText(/Only 3 active days/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /^Estimate/ })).not.toBeInTheDocument();
  });
});
