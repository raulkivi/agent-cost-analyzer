// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeReplay, NOT_REPLAYED_REASON } from "../../test-support/replay-fixture.js";
import { ReplaySummaryStrip } from "./ReplaySummaryStrip.js";

function renderStrip(replay = makeReplay(), handlers = { onOpenSummary: vi.fn(), onPricingChange: vi.fn() }) {
  render(<ReplaySummaryStrip replay={replay} vendorName="Anthropic" {...handlers} />);
  return { strip: screen.getByRole("region", { name: "Replay summary" }), ...handlers };
}

describe("ReplaySummaryStrip (step 14.7, board 1)", () => {
  it("shows measured, simulated and the signed difference, the simulated one labelled", () => {
    const { strip } = renderStrip();
    const measured = within(strip).getByRole("group", { name: "Measured total" });
    expect(measured).toHaveTextContent("claude-opus-5.5");
    expect(measured).toHaveTextContent("$0.80");
    const simulated = within(strip).getByRole("group", { name: "Simulated total" });
    expect(simulated).toHaveTextContent("Simulated");
    expect(simulated).toHaveTextContent("claude-sonnet-5.5");
    expect(simulated).toHaveTextContent("$0.48");
    expect(within(strip).getByRole("group", { name: "Difference, simulated minus measured" })).toHaveTextContent("−$0.32 −40.0% · USD");
  });

  it("says 'would have cost about', the coverage with its reason, the self-check and the prices", () => {
    const { strip } = renderStrip();
    expect(strip).toHaveTextContent("would have cost about $0.48 on claude-sonnet-5.5");
    expect(strip).toHaveTextContent(`2 of 3 turns replayed; 1 not replayed: ${NOT_REPLAYED_REASON}`);
    expect(strip).toHaveTextContent("Replay matches the log on claude-opus-5.5: 100% of compared requests");
    expect(strip).toHaveTextContent("Priced at the Anthropic API's prices as of 2026-10-21");
  });

  it("words a failed self-check as a warning", () => {
    const { strip } = renderStrip(makeReplay({ selfCheck: { model: "claude-opus-5.5", requests: 40, matching: 37, readTolerancePercent: 5, passed: false } }));
    expect(within(strip).getByText("Replay matches the log on claude-opus-5.5: 93% of compared requests").closest(".replay-self-check")).toHaveClass("replay-self-check--failed");
  });

  it("gives a neutral line when there is no self-check", () => {
    const { strip } = renderStrip(makeReplay({ selfCheck: null }));
    expect(strip).toHaveTextContent(/No self-check for this session/);
  });

  it("shows unknown totals as 'unknown', never 0", () => {
    const { strip } = renderStrip(
      makeReplay({
        totals: { measured: { value: 0.8, knownTurns: 2, turns: 3 }, simulated: { value: null, knownTurns: 0, turns: 3 }, difference: null },
      }),
    );
    expect(within(strip).getByRole("group", { name: "Simulated total" })).toHaveTextContent("unknown");
    expect(within(strip).getByRole("group", { name: "Difference, simulated minus measured" })).toHaveTextContent("unknown");
    expect(strip).not.toHaveTextContent("$0.00");
  });

  it("board 4d: with no price channel, says nothing simulated is priced, with the API's reason", () => {
    const reason = "No price channel is known, so nothing simulated is priced: the log records none.";
    const { strip } = renderStrip(makeReplay({ pricing: { channel: null, reason, asOf: "2026-10-21", requested: "session-channel" } }));
    expect(within(strip).getByRole("status")).toHaveTextContent(`Unpriced ${reason}`);
  });

  it("board 4e: with no price on that date, gives each turn's reason and offers the other channel", async () => {
    const reason = "The price book has no price for gpt-6.1-sol on openai-api before 2026-10-01.";
    const base = makeReplay();
    const turns = base.turns.map((turn) => (turn.simulated ? { ...turn, simulated: { ...turn.simulated, cost: { known: false as const, reason } } } : turn));
    const { strip, onPricingChange } = renderStrip(
      makeReplay({ turns, totals: { ...base.totals, simulated: { value: null, knownTurns: 0, turns: 3 }, difference: null } }),
    );
    expect(within(strip).getByRole("status")).toHaveTextContent(`Unpriced unknown: ${reason}`);
    await userEvent.click(within(strip).getByRole("button", { name: "Price at GitHub Copilot's prices instead" }));
    expect(onPricingChange).toHaveBeenCalledWith("copilot");
  });

  it("opens the summary from its button, by keyboard", async () => {
    const { strip, onOpenSummary } = renderStrip();
    const button = within(strip).getByRole("button", { name: "Replay summary" });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpenSummary).toHaveBeenCalled();
  });
});
