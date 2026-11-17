// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FakeAppHostPort } from "../../host/fake-app-host-port.js";
import type { ViewBrand } from "../../brand/view-brand.js";
import { axeViolations } from "../../test-support/axe.js";
import { claudeCodeSessionCost, sessionCost, turnSeries } from "../../view-models/fixtures.js";
import { claudeRun, claudeTurnView, missingClaudeRun, priced, turnView, unpriced } from "../../view-models/turn-view-fixture.js";
import { SessionCostView } from "../SessionCostView.js";

// Step CS13 (board U1TurnDetail): the expanded turn of a Claude Code session
// shows tokens, a priced cost with the runs' share and "AI Credits n/a", then
// each run's tokens and priced cost. Unknown reads Unknown, never 0.

const brand: ViewBrand = { productId: "standalone", displayName: "Agent Cost Analyzer", version: "0.11.0" };
const missing = "The subagent transcript this turn started is missing.";

async function openWith(view: ReturnType<typeof turnView>) {
  const port = new FakeAppHostPort();
  port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
  port.toolResults.set("get_turn", { structuredContent: view });
  const rendered = render(<SessionCostView port={port} brand={brand} clipboard={{ writeText: async () => undefined }} result={{ structuredContent: sessionCost() }} />);
  fireEvent.click(screen.getByRole("button", { name: /Turn 17/ }));
  await screen.findByRole("group", { name: "Tokens and priced cost" });
  return { port, ...rendered };
}

describe("SessionCostView turn detail without AI Credits", () => {
  it("shows tokens, the priced cost with the runs' share, and AI Credits n/a", async () => {
    await openWith(claudeTurnView([claudeRun(), claudeRun({ id: "agent-b", label: "Agent-general-purpose", model: "claude-sonnet-5.5", roundsCount: 6, total: 730_000, cost: priced(0.29) })]));
    const group = screen.getByRole("group", { name: "Tokens and priced cost" });
    expect(group).toHaveTextContent("Tokens 2.54M");
    expect(group).toHaveTextContent("Priced cost $0.59");
    expect(group).toHaveTextContent("incl. $0.38 from 2 subagent runs");
    expect(group).toHaveTextContent("AI Credits n/a");
    expect(group).toHaveTextContent("Claude Code has no AI Credits");
  });

  it("lists each run with model, requests, tokens and cost, then the totals and the price note", async () => {
    await openWith(claudeTurnView([claudeRun({ attribution: "timestamp" })]));
    const item = within(screen.getByRole("list", { name: "Subagent runs (1)" })).getByRole("listitem");
    expect(item).toHaveTextContent("Explore");
    expect(item).toHaveTextContent("matched by time");
    expect(item).toHaveTextContent("claude-haiku-4.5");
    expect(item).toHaveTextContent("9 requests");
    expect(item).toHaveTextContent("1.31M tokens $0.09");
    const group = screen.getByRole("group", { name: "Tokens and priced cost" });
    expect(group).toHaveTextContent("Main agent 0.50M · $0.21");
    expect(group).toHaveTextContent("Subagent runs 1.31M · $0.09");
    expect(group).toHaveTextContent("Turn 1.81M · $0.30");
    expect(group).toHaveTextContent("Priced at Anthropic prices as of 2026-10-01, each run on its own model.");
  });

  it("shows an unread run as Unknown with its reason, and no smaller total", async () => {
    await openWith(claudeTurnView([claudeRun({ total: 220_000, cost: priced(0.02) }), missingClaudeRun()], { ownTotal: 310_000, ownCost: priced(0.19) }));
    const group = screen.getByRole("group", { name: "Tokens and priced cost" });
    expect(group).toHaveTextContent("Tokens Unknown");
    expect(group).toHaveTextContent("Priced cost Unknown");
    expect(group).toHaveTextContent(`unknown: ${missing}`);
    const unread = within(screen.getByRole("list", { name: "Subagent runs (2)" })).getAllByRole("listitem")[1]!;
    expect(unread).toHaveTextContent("model unknown");
    expect(unread).toHaveTextContent(missing);
    expect(unread.textContent).not.toMatch(/\$0\.00/);
    expect(group).toHaveTextContent("Subagent runs unknown");
    expect(group).toHaveTextContent("This turn's tokens and cost are unknown until the Plan run can be read.");
  });

  it("leaves the Copilot AI Credits layout alone", async () => {
    const port = new FakeAppHostPort();
    port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
    port.toolResults.set("get_turn", { structuredContent: turnView() });
    render(<SessionCostView port={port} brand={brand} clipboard={{ writeText: async () => undefined }} result={{ structuredContent: sessionCost() }} />);
    fireEvent.click(screen.getByRole("button", { name: /Turn 17/ }));
    await screen.findByText("Hide turn");
    expect(screen.queryByRole("group", { name: "Tokens and priced cost" })).toBeNull();
  });

  it("renders hostile agent names and reasons only as text", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const { container } = await openWith(claudeTurnView([claudeRun({ label: `Agent-${hostile}`, cost: unpriced(hostile) })]));
    expect(container.querySelector("img[src]")).toBeNull();
    expect(container).toHaveTextContent(hostile);
  });

  it("opens by keyboard and passes axe in every state", async () => {
    const port = new FakeAppHostPort();
    port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
    port.toolResults.set("get_turn", { structuredContent: claudeTurnView([claudeRun(), missingClaudeRun()]) });
    render(<SessionCostView port={port} brand={brand} clipboard={{ writeText: async () => undefined }} result={{ structuredContent: sessionCost() }} />);
    const user = userEvent.setup();
    const toggle = screen.getByRole("button", { name: /Turn 17/ });
    toggle.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("group", { name: "Tokens and priced cost" });
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

// Chat views match the web app's KPI tiles for a session without AI Credits
// (C15, CS2 decision 1): a Priced cost tile, AI Credits n/a, never Unknown.
describe("SessionCostView tiles without AI Credits", () => {
  function renderClaude(cost = claudeCodeSessionCost()) {
    const port = new FakeAppHostPort();
    port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
    return render(<SessionCostView port={port} brand={brand} clipboard={{ writeText: async () => undefined }} result={{ structuredContent: cost }} />);
  }

  it("leads with the Priced cost tile and shows AI Credits as n/a", () => {
    renderClaude();
    const tiles = screen.getAllByRole("group").filter((group) => group.classList.contains("stat-tile"));
    expect(tiles[0]).toHaveTextContent("Priced cost");
    expect(tiles[0]).toHaveTextContent("$0.288");
    const credits = screen.getByRole("group", { name: "AI Credits" });
    expect(credits).toHaveTextContent("n/a");
    expect(credits).toHaveTextContent("Claude Code has no AI Credits");
    expect(credits).not.toHaveTextContent("Unknown");
  });

  it("keeps an unknown priced cost Unknown with its reason", () => {
    renderClaude(claudeCodeSessionCost(1, 3));
    const tile = screen.getByRole("group", { name: "Priced cost" });
    expect(tile).toHaveTextContent("Unknown");
    expect(tile).toHaveTextContent("The price book has no price for this model.");
    expect(tile.textContent).not.toMatch(/\$0/);
  });

  it("reads n/a in the Top turns AI Credits column", () => {
    renderClaude();
    const table = screen.getByRole("table", { name: "Top turns by input tokens" });
    const rows = within(table).getAllByRole("row").slice(1);
    for (const row of rows) expect(within(row).getAllByRole("cell")[2]).toHaveTextContent("n/a");
    expect(table).not.toHaveTextContent("Unknown AI");
  });

  it("gives a Copilot session no Priced cost tile", () => {
    const port = new FakeAppHostPort();
    port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
    render(<SessionCostView port={port} brand={brand} clipboard={{ writeText: async () => undefined }} result={{ structuredContent: sessionCost() }} />);
    expect(screen.queryByRole("group", { name: "Priced cost" })).toBeNull();
  });

  it("passes axe", async () => {
    renderClaude();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
