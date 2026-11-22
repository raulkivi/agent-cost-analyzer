// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { addTurnCostFigures, unknownCost, type SubagentTokens, type TurnCostFigures } from "@agent-cost-analyzer/domain";

// Step CS11 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/claude-code-subagents.md D13): the priced cost of a
// session's subagent runs, shared by the session summary and the replay
// coverage. Unknown, with a reason, when any token sum is (a session-level
// reason leaves no line to sum) or when no run line was priced; never 0.

const NO_RUN_COST_REASON = "No subagent run's cost line was priced.";

function unknownFigures(reason: string): TurnCostFigures {
  const unknown = unknownCost(reason);
  return { billed: unknown, reported: unknown, priced: unknown };
}

export function subagentSpendCost(tokens: SubagentTokens, runLineCosts: readonly (TurnCostFigures | undefined)[]): TurnCostFigures {
  const unknownToken = Object.values(tokens).find((count) => !count.known);
  if (unknownToken && !unknownToken.known) return unknownFigures(unknownToken.reason);
  const costs = runLineCosts.flatMap((cost) => (cost ? [cost] : []));
  if (costs.length === 0 || costs.length !== runLineCosts.length) return unknownFigures(NO_RUN_COST_REASON);
  return addTurnCostFigures(costs);
}
