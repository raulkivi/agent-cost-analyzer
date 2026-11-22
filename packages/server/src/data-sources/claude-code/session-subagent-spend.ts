// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { sumTokenCounts, unavailableTokenCount, type SubagentSpend, type TokenCount, type TurnUsage } from "@agent-cost-analyzer/domain";
import { NO_AI_CREDITS_REASON } from "./subagent-run-usage.js";

// Step CS11 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/claude-code-subagents.md D13): what a Claude Code
// session's subagent runs added, for the Sessions list and `get_session_cost`.
// Claude Code records no AI Credits, so the tokens stand in; the priced cost
// needs the price book, so the cost builder adds it.

const RUN_FIELDS = ["uncachedInput", "cacheWrite", "cacheRead", "output"] as const;

function sumField(usages: readonly TurnUsage[], field: (typeof RUN_FIELDS)[number]): TokenCount {
  const parts = usages.flatMap((usage) => usage.subagents ?? []).map((run) => run[field]);
  return parts.find((part) => !part.known) ?? sumTokenCounts(parts, "A subagent run's figure is unknown.");
}

/**
 * Absent when no run was counted and no session-level reason applies. A
 * reason (plan section 6) makes every figure unknown, as the turns' totals are.
 */
export function claudeCodeSubagentSpend(usages: readonly TurnUsage[], sessionUnknownReasons: readonly string[]): SubagentSpend | undefined {
  const runs = usages.reduce((count, usage) => count + (usage.subagents?.length ?? 0), 0);
  if (runs === 0 && sessionUnknownReasons.length === 0) return undefined;
  const reason = sessionUnknownReasons.join(" ");
  const tokens = Object.fromEntries(
    RUN_FIELDS.map((field) => [field, reason === "" ? sumField(usages, field) : unavailableTokenCount(reason)]),
  ) as NonNullable<SubagentSpend["tokens"]>;
  return { runs, costAiCredits: unavailableTokenCount(NO_AI_CREDITS_REASON), tokens };
}
