// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetViewStateStorage } from "../../state/current-view-state-storage.js";
import { makeReplay, NOT_REPLAYED_REASON } from "../../test-support/replay-fixture.js";
import { ReplaySummaryPanel } from "./ReplaySummaryPanel.js";

function renderPanel(replay = makeReplay(), onClose = vi.fn(), onPricingChange = vi.fn()) {
  render(
    <ReplaySummaryPanel replay={replay} sessionTitle="Refactor the price book loader" vendorName="Anthropic" onClose={onClose} onPricingChange={onPricingChange} />,
  );
  return { dialog: screen.getByRole("dialog", { name: "Refactor the price book loader on claude-sonnet-5.5" }), onClose, onPricingChange };
}

describe("ReplaySummaryPanel (step 14.7, board 2)", () => {
  beforeEach(() => resetViewStateStorage());

  it("is a labelled modal dialog with the Simulated label and the three totals", () => {
    const { dialog } = renderPanel();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getAllByText("Simulated").length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("group", { name: "Measured total" })).toHaveTextContent("$0.80");
    expect(within(dialog).getByRole("group", { name: "Simulated total" })).toHaveTextContent("$0.48");
    expect(within(dialog).getByRole("group", { name: "Difference, simulated minus measured" })).toHaveTextContent("−$0.32");
    expect(dialog).toHaveTextContent("computed on request, never stored");
  });

  it("switches the price channel, calling back with copilot or api", async () => {
    const { dialog, onPricingChange } = renderPanel();
    const channel = within(dialog).getByRole("radiogroup", { name: "Price channel" });
    expect(within(channel).getByRole("radio", { name: "Anthropic API" })).toHaveAttribute("aria-checked", "true");
    expect(within(channel).getByRole("radio", { name: "GitHub Copilot" })).toHaveAttribute("aria-checked", "false");
    expect(dialog).toHaveTextContent("Priced at the Anthropic API's prices as of 2026-10-21");
    await userEvent.click(within(channel).getByRole("radio", { name: "GitHub Copilot" }));
    expect(onPricingChange).toHaveBeenCalledWith("copilot");
  });

  it("gives the reason when no price channel is known", () => {
    const reason = "No price channel is known, so nothing simulated is priced: the log records none.";
    const { dialog } = renderPanel(makeReplay({ pricing: { channel: null, reason, asOf: "2026-10-21", requested: "session-channel" } }));
    expect(dialog).toHaveTextContent(reason);
    within(dialog).getAllByRole("radio").forEach((radio) => expect(radio).toHaveAttribute("aria-checked", "false"));
  });

  it("groups the turns not replayed by reason, with their numbers", () => {
    const { dialog } = renderPanel();
    const coverage = within(dialog).getByRole("region", { name: "Coverage" });
    expect(coverage).toHaveTextContent("2 of 3 turns replayed");
    expect(coverage).toHaveTextContent(`1 turn: ${NOT_REPLAYED_REASON} (turn 1)`);
    expect(coverage).toHaveTextContent("Both totals cover the same 2 turns");
  });

  it("words the self-check both ways, with the 5% / exact rule", () => {
    const { dialog } = renderPanel();
    const check = within(dialog).getByRole("region", { name: "Self-check" });
    expect(check).toHaveTextContent("Replay matches the log on claude-opus-5.5: 100% of compared requests");
    expect(check).toHaveTextContent("8 of 8 compared requests match.");
    expect(check).toHaveTextContent("within 5% of the log's and its cache hit or miss is exactly the log's");
  });

  it("warns when the self-check failed", () => {
    const { dialog } = renderPanel(makeReplay({ selfCheck: { model: "claude-opus-5.5", models: ["claude-opus-5.5"], requests: 40, matching: 37, readTolerancePercent: 5, passed: false } }));
    const check = within(dialog).getByRole("region", { name: "Self-check" });
    expect(check).toHaveTextContent("Replay matches the log on claude-opus-5.5: 93% of compared requests");
    expect(check).toHaveTextContent("37 of 40 compared requests match; 3 disagree.");
    expect(check).toHaveTextContent("rest on this check, so read them with care");
  });

  it("shows the assumptions open the first time, A4 greyed when not used, and closed after that", async () => {
    const { dialog, onClose } = renderPanel();
    const toggle = within(dialog).getByRole("button", { name: /Assumptions \(4\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = within(dialog).getByRole("list", { name: "Assumptions" });
    expect(list).toHaveTextContent("A1 · Same conversation");
    expect(list).toHaveTextContent("main caveat");
    expect(within(list).getByText(/A4 · Inferred cache writes/).closest("li")).toHaveClass("replay-assumption--unused");
    expect(list).toHaveTextContent("not used for this session");
    expect(within(list).getAllByText("unknown")).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();

    document.body.innerHTML = "";
    const again = renderPanel();
    expect(within(again.dialog).getByRole("button", { name: /Assumptions \(4\)/ })).toHaveAttribute("aria-expanded", "false");
    expect(within(again.dialog).queryByRole("list", { name: "Assumptions" })).not.toBeInTheDocument();
  });

  it("lists A4 as used when the replay inferred writes", () => {
    const base = makeReplay();
    const { dialog } = renderPanel(makeReplay({ assumptions: [...base.assumptions, { id: "A4", text: "Inferred cache writes: the log records none.", confidence: "inferred" }] }));
    expect(within(dialog).getByText(/A4 · Inferred cache writes/).closest("li")).not.toHaveClass("replay-assumption--unused");
  });

  it("traps focus, closes on Escape and gives focus back to its opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Replay summary";
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const { unmount } = render(
      <ReplaySummaryPanel replay={makeReplay()} sessionTitle="T" vendorName="Anthropic" onClose={onClose} onPricingChange={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
