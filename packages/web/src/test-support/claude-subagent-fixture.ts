// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostFigure, SubagentRunUsage, TokenCount, Turn } from "@agent-cost-analyzer/domain";
import { makeTurn } from "./turn-fixture.js";

// Step CS13: Claude Code turns with runs, as the API sends them: tokens and
// a priced cost on the turn, the main agent's own line and each run; no AI
// Credits anywhere (the numbers are those of the CS2 boards).

export const NO_CREDITS = { known: false as const, reason: "AI Credits are GitHub Copilot's own billing unit — a Claude Code CLI session has no AI Credits conversion." };
export const priced = (amount: number): CostFigure => ({ known: true, amount, currency: "USD", basis: "priced", priceVersionIds: ["anthropic-api:claude-sonnet-5.5:2026-10-01"] });
export const unpriced = (reason: string): CostFigure => ({ known: false, reason });
const known = (value: number): TokenCount => ({ known: true, value });

type TokenField = "uncachedInput" | "cacheWrite" | "cacheRead" | "output";

// Four token fields that add up to `total`.
export function fields(total: number): Record<TokenField, TokenCount> {
  const cacheRead = Math.round(total * 0.7);
  const each = Math.round(total * 0.1);
  return { uncachedInput: known(each), cacheWrite: known(each), cacheRead: known(cacheRead), output: known(total - cacheRead - 2 * each) };
}

export function makeClaudeRun(overrides: Partial<SubagentRunUsage> & { total?: number; cost?: CostFigure } = {}): SubagentRunUsage {
  const { total = 1_310_000, cost = priced(0.09), ...rest } = overrides;
  return {
    id: "agent-a1",
    label: "Agent-Explore",
    model: "claude-haiku-4.5",
    roundsCount: 9,
    ...fields(total),
    reasoning: known(0),
    costAiCredits: NO_CREDITS,
    attribution: "tool-use-id",
    pricedCost: cost,
    ...rest,
  };
}

// A run whose transcript is missing: nothing of it is known.
export function makeMissingRun(overrides: Partial<SubagentRunUsage> = {}): SubagentRunUsage {
  const gone: TokenCount = { known: false, reason: "The subagent transcript this turn started is missing." };
  return makeClaudeRun({
    id: "agent-a2",
    label: "Agent-Plan",
    model: "unknown",
    roundsCount: 0,
    uncachedInput: gone,
    cacheWrite: gone,
    cacheRead: gone,
    output: gone,
    reasoning: gone,
    pricedCost: unpriced("Cannot price: The log records no model for this turn."),
    ...overrides,
  });
}

export function makeClaudeTurn(runs: SubagentRunUsage[], options: { ownTotal?: number; ownCost?: CostFigure; index?: number } = {}): Turn {
  const { ownTotal = 500_000, ownCost = priced(0.21), index = 3 } = options;
  const own = fields(ownTotal);
  const sum = (field: TokenField): TokenCount => {
    const parts = [own[field], ...runs.map((run) => run[field])];
    const unknownPart = parts.find((part) => !part.known);
    if (unknownPart && !unknownPart.known) return unknownPart;
    return known(parts.reduce((total, part) => total + (part as { value: number }).value, 0));
  };
  const costs = [ownCost, ...runs.map((run) => run.pricedCost!)];
  const unknownCost = costs.find((cost) => !cost.known);
  const turnCost: CostFigure = unknownCost && !unknownCost.known ? unknownCost : priced(costs.reduce((total, cost) => total + (cost as { amount: number }).amount, 0));
  const base = makeTurn({ index }).usage;
  return makeTurn({
    index,
    usage: {
      ...base,
      uncachedInput: sum("uncachedInput"),
      cacheWrite: sum("cacheWrite"),
      cacheRead: sum("cacheRead"),
      output: sum("output"),
      model: "claude-sonnet-5.5",
      costAiCredits: NO_CREDITS,
      pricedCost: turnCost,
      subagents: runs,
      ownUsage: { ...base, ...own, reasoning: known(0), costAiCredits: NO_CREDITS, pricedCost: ownCost, model: "claude-sonnet-5.5" },
    },
  });
}
