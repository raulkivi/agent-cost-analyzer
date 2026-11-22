// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { isPricedProvider, type Session, type SubagentSpend, type Turn, type TurnCostFigures, type TurnUsage } from "@agent-cost-analyzer/domain";
import { NOT_ATTRIBUTED } from "../insights/insights-dataset-builder.js";
import { turnLinesOf } from "../pricing/turn-cost-lines.js";
import type { SessionCostSources } from "../analysis/analysis-query-service.js";
import { subagentSpendCost } from "./subagent-spend-cost.js";

// Step CS13 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/claude-code-subagents.md §5.6): a Claude Code
// session has no AI Credits, so the web UI and the MCP App read the priced
// cost from the usage: `pricedCost` on the turn, the main agent's own line
// and each run, each line priced on its own model (the same lines the cost
// builders use). Applied to the API's answer only; nothing is stored.

function pricedUsage(usage: TurnUsage, whole: TurnCostFigures, lines: readonly TurnCostFigures[] | undefined): TurnUsage {
  const priced = { pricedCost: whole.priced };
  if (!lines || !usage.ownUsage || !usage.subagents) return { ...usage, ...priced };
  const [own, ...runs] = lines;
  return {
    ...usage,
    ...priced,
    ownUsage: { ...usage.ownUsage, ...(own ? { pricedCost: own.priced } : {}) },
    subagents: usage.subagents.map((run, index) => {
      const cost = runs[index];
      return cost ? { ...run, pricedCost: cost.priced } : run;
    }),
  };
}

export function withPricedCosts(session: Session, providerId: string, sources: SessionCostSources): Session {
  if (!isPricedProvider(providerId) || !sources.pricer) return session;
  const pricer = sources.pricer.snapshot();
  const attributor = sources.attribution?.snapshot();
  const runLineCosts: TurnCostFigures[] = [];
  const turns = session.turns.map((turn): Turn => {
    const attribution = attributor?.turn(providerId, session, turn) ?? NOT_ATTRIBUTED;
    const whole = pricer.figuresFor(providerId, session, turn, attribution);
    const lines = turnLinesOf(turn.usage)?.map((line) => pricer.figuresFor(providerId, session, { ...turn, usage: line.usage }, attribution));
    if (lines) runLineCosts.push(...lines.slice(1));
    return { ...turn, usage: pricedUsage(turn.usage, whole, lines) };
  });
  const spend: SubagentSpend | undefined = session.subagentSpend;
  const subagentSpend = spend?.tokens ? { ...spend, cost: subagentSpendCost(spend.tokens, runLineCosts) } : spend;
  return { ...session, turns, ...(subagentSpend ? { subagentSpend } : {}) };
}
