// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { SubagentSpend } from "@agent-cost-analyzer/domain";
import { makeTurn } from "../test-support/turn-fixture.js";
import { fields, makeClaudeRun, makeClaudeTurn, makeMissingRun, NO_CREDITS, priced, unpriced } from "../test-support/claude-subagent-fixture.js";
import { sessionListSubagentLine } from "./subagent-runs.js";
import { formatTokenTotal, isPricedUsage, pricedBreakdown, pricedMarker, pricedSessionLine, pricedSessionTotal, pricedTurnFigures } from "./subagent-priced.js";

// Step CS13 (CS2 boards): what a Claude Code turn shows of its subagent runs:
// tokens and a priced cost, never an AI Credits figure; unknown is never 0.

const generalPurpose = () => makeClaudeRun({ id: "agent-a3", label: "Agent-general-purpose", model: "claude-sonnet-5.5", roundsCount: 6, total: 730_000, cost: priced(0.29) });
const knownTurn = () => makeClaudeTurn([makeClaudeRun(), generalPurpose()]);

describe("formatTokenTotal", () => {
  it.each([
    [950, "950"],
    [88_000, "88k"],
    [4_100, "4.1k"],
    [500_000, "0.50M"],
    [2_040_000, "2.04M"],
    [31_400_000, "31.4M"],
  ])("%d reads %s", (value, text) => {
    expect(formatTokenTotal(value)).toBe(text);
  });
});

describe("isPricedUsage", () => {
  it("is true only where the API set a priced cost", () => {
    expect(isPricedUsage(knownTurn().usage)).toBe(true);
    expect(isPricedUsage(makeTurn().usage)).toBe(false);
  });
});

describe("pricedMarker", () => {
  it("is undefined without runs", () => {
    expect(pricedMarker(makeTurn().usage)).toBeUndefined();
  });

  it("lists tokens before cost, then the run count", () => {
    expect(pricedMarker(knownTurn().usage)).toEqual({ unknown: false, text: "incl. 2.04M tokens, $0.38 priced, from 2 subagent runs" });
  });

  it("adds 'matched by time' and uses the singular", () => {
    const turn = makeClaudeTurn([makeClaudeRun({ attribution: "timestamp" })]);
    expect(pricedMarker(turn.usage)?.text).toBe("incl. 1.31M tokens, $0.09 priced, from 1 subagent run, matched by time");
  });

  it("reads tokens and cost unknown with the reason for a missing transcript", () => {
    const turn = makeClaudeTurn([makeClaudeRun(), makeMissingRun()]);
    expect(pricedMarker(turn.usage)).toEqual({ unknown: true, text: "Tokens and cost unknown: the subagent transcript this turn started is missing." });
  });

  it("names the one unknown field and says the others include the run", () => {
    const gone = { known: false as const, reason: "A subagent round has no cache-write count." };
    const turn = makeClaudeTurn([makeClaudeRun({ cacheWrite: gone, cost: unpriced("a round of this run has no cache-write count") })]);
    expect(pricedMarker(turn.usage)).toEqual({ unknown: true, text: "Cache write unknown: a subagent round has no cache-write count. The other columns include the run." });
  });
});

describe("pricedBreakdown", () => {
  it("is undefined without runs", () => {
    expect(pricedBreakdown(makeTurn().usage)).toBeUndefined();
  });

  it("lists each run with model, requests, tokens and cost, then the totals", () => {
    const view = pricedBreakdown(knownTurn().usage)!;
    expect(view.runs.map((run) => [run.name, run.model, run.requests, run.tokens.text, run.cost.text])).toEqual([
      ["Explore", "claude-haiku-4.5", "9 requests", "1.31M", "$0.09"],
      ["general-purpose", "claude-sonnet-5.5", "6 requests", "0.73M", "$0.29"],
    ]);
    expect([view.main.text, view.subagents.text, view.turn.text]).toEqual(["0.50M · $0.21", "2.04M · $0.38", "2.54M · $0.59"]);
    expect(view.share).toBe("Subagent runs are 80% of this turn's tokens and 64% of its priced cost.");
    expect(view.unknownNote).toBeUndefined();
    expect(view.pricedAsOf).toBe("2026-10-01");
  });

  it("flags a run matched by time and a nested run's parent", () => {
    const parent = makeClaudeRun({ id: "agent-p", label: "Agent-general-purpose", attribution: "timestamp" });
    const child = makeClaudeRun({ id: "agent-c", label: "Agent-Explore", parentRunId: "agent-p", total: 110_000, cost: priced(0.01) });
    const view = pricedBreakdown(makeClaudeTurn([parent, child]).usage)!;
    expect(view.runs[0]).toMatchObject({ matchedByTime: true });
    expect(view.runs[1]).toMatchObject({ startedBy: "general-purpose" });
  });

  it("shows an unread run as dashes with its reason, and adds no smaller total", () => {
    const view = pricedBreakdown(makeClaudeTurn([makeClaudeRun({ total: 220_000, cost: priced(0.02) }), makeMissingRun()], { ownTotal: 310_000, ownCost: priced(0.19) }).usage)!;
    expect(view.runs[1]).toMatchObject({ unknown: true, model: "model unknown", requests: "requests unknown", reason: "The subagent transcript this turn started is missing." });
    expect([view.runs[1]!.tokens.text, view.runs[1]!.cost.text]).toEqual(["—", "—"]);
    expect([view.main.text, view.subagents.text, view.turn.text]).toEqual(["0.31M · $0.19", "unknown", "unknown"]);
    expect(view.share).toBeUndefined();
    expect(view.unknownNote).toBe("This turn's tokens and cost are unknown until the Plan run can be read.");
  });

  it("keeps tokens when only the cost is unknown", () => {
    const gone = { known: false as const, reason: "a round of this run has no cache-write count" };
    const turn = makeClaudeTurn([makeClaudeRun({ total: 90_000, cost: unpriced(gone.reason) })], { ownTotal: 88_000, ownCost: priced(0.04) });
    const view = pricedBreakdown(turn.usage)!;
    expect(view.runs[0]).toMatchObject({ unknown: true, reason: gone.reason });
    expect(view.runs[0]!.tokens.text).toBe("90k");
    expect([view.subagents.text, view.turn.text]).toEqual(["90k · cost unknown", "0.18M · cost unknown"]);
    expect(view.unknownNote).toBe("This turn's cost is unknown until the Explore run can be read.");
  });

  it("never prints a 0 for a field a run left unknown", () => {
    const run = makeClaudeRun({ cacheWrite: { known: false, reason: "no cache-write count" }, cost: unpriced("no cache-write count") });
    const view = pricedBreakdown(makeClaudeTurn([run]).usage)!;
    expect(view.runs[0]!.tokens).toEqual({ text: "—", known: false });
    expect(view.subagents.text).toBe("unknown");
  });

  it("says nothing of AI Credits", () => {
    const view = pricedBreakdown(knownTurn().usage)!;
    expect(JSON.stringify(view)).not.toMatch(/\d AI Credits/);
  });

  it("leaves the date out when no price version names one", () => {
    const run = makeClaudeRun({ cost: { known: true, amount: 0.09, currency: "USD", basis: "priced" } });
    const turn = makeClaudeTurn([run], { ownCost: { known: true, amount: 0.21, currency: "USD", basis: "priced" } });
    const usage = { ...turn.usage, pricedCost: { known: true as const, amount: 0.3, currency: "USD" as const, basis: "priced" as const } };
    expect(pricedBreakdown(usage)?.pricedAsOf).toBeUndefined();
  });
});

describe("pricedSessionLine and pricedSessionTotal", () => {
  const tokens = { uncachedInput: { known: true as const, value: 1_000_000 }, cacheWrite: { known: true as const, value: 400_000 }, cacheRead: { known: true as const, value: 30_000_000 }, output: { known: true as const, value: 100_000 } };
  const cost = { billed: unpriced("none"), reported: unpriced("none"), priced: priced(9.2) };
  const spend = (overrides: Partial<SubagentSpend> = {}): SubagentSpend => ({ runs: 14, costAiCredits: NO_CREDITS, tokens, cost, ...overrides });

  it("reads cost and tokens from the runs", () => {
    expect(pricedSessionLine(spend())).toBe("incl. $9.20 and 31.5M tokens from 14 subagent runs");
  });

  it("is undefined for a spend without tokens (Copilot)", () => {
    expect(pricedSessionLine(spend({ tokens: undefined }))).toBeUndefined();
  });

  it("reads unknown with the reason of the unknown token sum", () => {
    const gone = { known: false as const, reason: "The subagent transcript this turn started is missing." };
    expect(pricedSessionLine(spend({ tokens: { ...tokens, cacheRead: gone } }))).toBe(`unknown: ${gone.reason}`);
  });

  it("keeps the tokens when only the cost is unknown", () => {
    const unknown = { ...cost, priced: unpriced("No subagent run's cost line was priced.") };
    expect(pricedSessionLine(spend({ cost: unknown }))).toBe("incl. 31.5M tokens from 14 subagent runs; cost unknown: No subagent run's cost line was priced.");
  });

  it("totals the turns' priced cost, unknown when one turn is", () => {
    const turns = [makeClaudeTurn([], { index: 0 }), makeClaudeTurn([], { index: 1 })];
    expect(pricedSessionTotal(turns)).toEqual({ value: "$0.42" });
    const gap = makeClaudeTurn([], { index: 2, ownCost: unpriced("no price for this model") });
    expect(pricedSessionTotal([...turns, gap])).toEqual({ value: "unknown", reason: "no price for this model" });
  });

  it("is undefined when no turn was priced", () => {
    expect(pricedSessionTotal([makeTurn()])).toBeUndefined();
    expect(fields(10)).toBeDefined();
  });
});

describe("sessionListSubagentLine for a session without AI Credits", () => {
  const tokens = { uncachedInput: { known: true as const, value: 1_000_000 }, cacheWrite: { known: true as const, value: 400_000 }, cacheRead: { known: true as const, value: 30_000_000 }, output: { known: true as const, value: 100_000 } };

  it("lists tokens only: the list is not priced", () => {
    expect(sessionListSubagentLine({ runs: 2, costAiCredits: NO_CREDITS, tokens })).toBe("incl. 31.5M tokens from 2 subagent runs");
  });

  it("says tokens unknown with the reason, never a smaller sum", () => {
    const gone = { known: false as const, reason: "The subagent transcript this turn started is missing." };
    expect(sessionListSubagentLine({ runs: 1, costAiCredits: NO_CREDITS, tokens: { ...tokens, output: gone } })).toBe(`tokens unknown: ${gone.reason}`);
  });
});

describe("costNote and pricedTurnFigures", () => {
  it("words the runs' share of the turn's cost without 'matched by time'", () => {
    const turn = makeClaudeTurn([makeClaudeRun({ attribution: "timestamp" }), generalPurpose()]);
    expect(pricedBreakdown(turn.usage)?.costNote).toEqual({ text: "incl. $0.38 from 2 subagent runs", known: true });
  });

  it("reads unknown with the unread run's reason", () => {
    const turn = makeClaudeTurn([makeClaudeRun(), makeMissingRun()]);
    expect(pricedBreakdown(turn.usage)?.costNote).toEqual({ text: "unknown: The subagent transcript this turn started is missing.", known: false });
  });

  it("gives a turn's tokens and cost, with the reason when unknown, and nothing for another provider", () => {
    expect(pricedTurnFigures(knownTurn().usage)).toEqual({ tokens: { text: "2.54M", known: true }, cost: { text: "$0.59", known: true } });
    const unread = pricedTurnFigures(makeClaudeTurn([makeMissingRun()]).usage)!;
    expect(unread).toMatchObject({ tokens: { text: "—", known: false }, cost: { text: "—", known: false }, reason: "The subagent transcript this turn started is missing." });
    expect(pricedTurnFigures(makeTurn().usage)).toBeUndefined();
  });
});
