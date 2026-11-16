// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { CostFigure, Session, Turn, TurnCostFigures } from "@agent-cost-analyzer/domain";
import { withPricedCosts } from "./priced-subagent-usage.js";
import type { TurnPricer } from "../pricing/turn-cost-figures.js";
import { foldRuns, known, mainUsage, subagentRun } from "../../test-support/subagent-usage-fakes.js";

// Step CS13: the API puts priced figures on a Claude Code session's usage,
// so the web UI and the MCP App show a cost where there are no AI Credits.

const priced = (amount: number): CostFigure => ({ known: true, amount, currency: "USD", basis: "priced" });
const unknown = (reason: string): CostFigure => ({ known: false, reason });
const figures = (priced_: CostFigure): TurnCostFigures => ({ billed: unknown("none"), reported: unknown("none"), priced: priced_ });

// Prices a line by its model: opus 1.00, haiku 0.10, anything else unknown.
const pricer: TurnPricer = {
  figuresFor: (_provider, _session, turn) => {
    const { model } = turn.usage;
    return figures(model === "claude-opus-5" ? priced(1) : model === "claude-haiku-4.5" ? priced(0.1) : unknown("no price for " + model));
  },
};
const sources = { pricer: { snapshot: () => pricer } };

function sessionOf(turns: Turn[], extra: Partial<Session> = {}): Session {
  return { id: "s", mode: "analyze", title: "t", model: "claude-opus-5", turns, turnCount: turns.length, costAiCredits: unknownCredits(), usageDataAvailable: true, ...extra } as Session;
}
function unknownCredits() {
  return { known: false as const, reason: "no AI Credits" };
}
function turn(index: number, usage: Turn["usage"]): Turn {
  return { index, userMessage: "", assistantResponse: "", explanation: "", toolCalls: [], usage } as unknown as Turn;
}

describe("withPricedCosts", () => {
  it("prices the turn, the own line and each run on its own model", () => {
    const usage = foldRuns(mainUsage({ model: "claude-opus-5" }), [subagentRun({ id: "a", model: "claude-haiku-4.5" }), subagentRun({ id: "b", model: "claude-haiku-4.5" })]);
    const out = withPricedCosts(sessionOf([turn(0, usage)]), "claude-code", sources);
    const u = out.turns[0]!.usage;
    expect(u.ownUsage?.pricedCost).toEqual(priced(1));
    expect(u.subagents?.map((run) => run.pricedCost)).toEqual([priced(0.1), priced(0.1)]);
    expect(u.pricedCost).toMatchObject({ known: true, basis: "priced" });
  });

  it("prices a turn without runs, so the session total has every turn", () => {
    const out = withPricedCosts(sessionOf([turn(0, mainUsage({ model: "claude-opus-5" }))]), "claude-code", sources);
    expect(out.turns[0]!.usage.pricedCost).toEqual(priced(1));
  });

  it("leaves a run unknown with the pricer's reason, never 0", () => {
    const usage = foldRuns(mainUsage({ model: "claude-opus-5" }), [subagentRun({ model: "mystery" })]);
    const run = withPricedCosts(sessionOf([turn(0, usage)]), "claude-code", sources).turns[0]!.usage.subagents![0]!;
    expect(run.pricedCost).toEqual(unknown("no price for mystery"));
  });

  it("sets the session's subagent priced cost from the run lines", () => {
    const usage = foldRuns(mainUsage({ model: "claude-opus-5" }), [subagentRun({ model: "claude-haiku-4.5" })]);
    const tokens = { uncachedInput: known(100), cacheWrite: known(20), cacheRead: known(900), output: known(60) };
    const spend = { runs: 1, costAiCredits: unknownCredits(), tokens };
    const out = withPricedCosts(sessionOf([turn(0, usage)], { subagentSpend: spend }), "claude-code", sources);
    expect(out.subagentSpend?.cost?.priced).toEqual(priced(0.1));
  });

  it("changes nothing for another provider or without a pricer", () => {
    const session = sessionOf([turn(0, mainUsage())]);
    expect(withPricedCosts(session, "vscode", sources)).toBe(session);
    expect(withPricedCosts(session, "claude-code", {})).toBe(session);
  });
});
