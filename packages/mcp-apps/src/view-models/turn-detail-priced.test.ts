// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { toTurnDetailViewModel } from "./turn-detail.js";
import { claudeRun, claudeTurnView, missingClaudeRun, priced, unpriced } from "./turn-view-fixture.js";
import { turnView } from "./turn-view-fixture.js";

// Step CS13 (board U1TurnDetail): a Claude Code turn shows tokens, a priced
// cost with the runs' share, and "AI Credits n/a"; each run lists tokens and
// a priced cost. Unknown is never 0.

const missing = "The subagent transcript this turn started is missing.";
const generalPurpose = () => claudeRun({ id: "agent-b", label: "Agent-general-purpose", model: "claude-sonnet-5.5", roundsCount: 6, total: 730_000, cost: priced(0.29) });

describe("toTurnDetailViewModel for a turn without AI Credits", () => {
  it("leaves a Copilot turn without a priced section", () => {
    expect(toTurnDetailViewModel(turnView()).priced).toBeUndefined();
  });

  it("shows tokens, the priced cost with the runs' share, and AI Credits n/a", () => {
    const vm = toTurnDetailViewModel(claudeTurnView([claudeRun(), generalPurpose()]));
    expect(vm.priced?.tokens).toEqual({ text: "2.54M", known: true, estimate: false });
    expect(vm.priced?.cost).toEqual({ text: "$0.59", known: true, estimate: false });
    expect(vm.priced?.costNote).toEqual({ text: "incl. $0.38 from 2 subagent runs", known: true });
    expect(vm.aiCredits).toMatchObject({ text: "n/a", unknownNote: "Claude Code has no AI Credits" });
    expect(JSON.stringify(vm.priced)).not.toMatch(/\d AI Credits/);
  });

  it("lists runs by agent name with model, requests, tokens and cost, then the totals", () => {
    const section = toTurnDetailViewModel(claudeTurnView([claudeRun(), generalPurpose()])).priced!.section!;
    expect(section.heading).toBe("Subagent runs (2)");
    expect(section.runs.map((run) => [run.name, run.model, run.requests, run.tokens.text, run.cost.text])).toEqual([
      ["Explore", "claude-haiku-4.5", "9 requests", "1.31M", "$0.09"],
      ["general-purpose", "claude-sonnet-5.5", "6 requests", "0.73M", "$0.29"],
    ]);
    expect([section.mainAgent, section.subagents, section.turn]).toEqual(["0.50M · $0.21", "2.04M · $0.38", "2.54M · $0.59"]);
    expect(section.share).toBe("Subagent runs are 80% of this turn's tokens and 64% of its priced cost.");
    expect(section.priceNote).toBe("Priced at Anthropic prices as of 2026-10-01, each run on its own model. Claude Code has no AI Credits.");
  });

  it("flags a run matched by time", () => {
    const section = toTurnDetailViewModel(claudeTurnView([claudeRun({ attribution: "timestamp" })])).priced!.section!;
    expect(section.runs[0]!.matchedByTime).toBe(true);
    expect(section.runs[0]!.startedBy).toBeUndefined();
  });

  it("shows an unknown run as dashes with its reason and no smaller total", () => {
    const vm = toTurnDetailViewModel(claudeTurnView([claudeRun({ total: 220_000, cost: priced(0.02) }), missingClaudeRun()], { ownTotal: 310_000, ownCost: priced(0.19) }));
    expect(vm.priced).toMatchObject({ tokens: { text: "Unknown", known: false }, cost: { text: "Unknown", known: false }, costNote: { text: `unknown: ${missing}`, known: false } });
    expect(vm.priced?.reason).toBe(missing);
    const section = vm.priced!.section!;
    expect(section.runs[1]).toMatchObject({ name: "Plan", model: "model unknown", unknown: true, reason: missing });
    expect(section.runs[1]!.tokens.text).toBe("Unknown");
    expect(section.runs[1]!.cost.text).toBe("Unknown");
    expect([section.mainAgent, section.subagents, section.turn]).toEqual(["0.31M · $0.19", "unknown", "unknown"]);
    expect(section.share).toBeUndefined();
    expect(section.unknownNote).toBe("This turn's tokens and cost are unknown until the Plan run can be read.");
  });

  it("shows the priced figures of a turn with no runs and no section", () => {
    const vm = toTurnDetailViewModel(claudeTurnView([]));
    expect(vm.priced).toMatchObject({ tokens: { text: "0.50M", known: true }, cost: { text: "$0.21", known: true } });
    expect(vm.priced?.costNote).toBeUndefined();
    expect(vm.priced?.section).toBeUndefined();
  });

  it("keeps a figure unknown when only the priced cost is", () => {
    const vm = toTurnDetailViewModel(claudeTurnView([claudeRun({ cost: unpriced("a round of this run has no cache-write count") })]));
    expect(vm.priced?.tokens.known).toBe(true);
    expect(vm.priced?.cost).toMatchObject({ text: "Unknown", known: false });
  });
});
