// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  sumTokenCounts,
  unavailableTokenCount,
  type OwnTurnUsage,
  type SubagentRunUsage,
  type TokenCount,
  type TurnUsage,
} from "@agent-cost-analyzer/domain";

// The figures a turn and its runs both carry, folded by summing.
const SUMMED_FIELDS = ["uncachedInput", "cacheWrite", "cacheRead", "reasoning", "output", "costAiCredits"] as const;
type SummedField = (typeof SUMMED_FIELDS)[number];

// All-or-nothing, as sumTokenCounts, but an unknown total keeps the first
// unknown part's own reason, which says more than a generic one.
function sumParts(parts: readonly TokenCount[]): TokenCount {
  const firstUnknown = parts.find((part) => !part.known);
  return sumTokenCounts([...parts], firstUnknown?.known === false ? firstUnknown.reason : "");
}

export function ownUsageOf(usage: TurnUsage): OwnTurnUsage {
  const { uncachedInput, cacheWrite, cacheRead, tool, vision, reasoning, output, costAiCredits, extendedCacheWrite, model } = usage;
  return {
    uncachedInput,
    cacheWrite,
    cacheRead,
    tool,
    vision,
    reasoning,
    output,
    costAiCredits,
    ...(extendedCacheWrite === undefined ? {} : { extendedCacheWrite }),
    model,
  };
}

const NOT_RECORDED_REASON =
  "The log does not split this part's cache writes by lifetime, so how many were 1-hour writes is unknown.";

// The 1-hour part of cacheWrite is recorded by Claude Code (turn and runs) and
// not by Copilot. It is folded only when some part records it, and a part
// that doesn't makes the total unknown: not recorded is never 0 (constraint 6).
function foldExtendedCacheWrite(
  usage: TurnUsage,
  runs: readonly SubagentRunUsage[],
  unread: readonly TokenCount[],
): { extendedCacheWrite?: TokenCount } {
  if (usage.extendedCacheWrite === undefined && runs.every((run) => run.extendedCacheWrite === undefined)) return {};
  const missing = unavailableTokenCount(NOT_RECORDED_REASON);
  return {
    extendedCacheWrite: sumParts([
      ...unread,
      usage.extendedCacheWrite ?? missing,
      ...runs.map((run) => run.extendedCacheWrite ?? missing),
    ]),
  };
}

function foldRuns(usage: TurnUsage, runs: readonly SubagentRunUsage[], unreadReason: string | undefined): TurnUsage {
  // An unread run has no figures: it stands as an unknown part in every sum,
  // so no total leaves its requests out (constraint 6).
  const unread = unreadReason === undefined ? [] : [unavailableTokenCount(unreadReason)];
  const folded = Object.fromEntries(
    SUMMED_FIELDS.map((field) => [field, sumParts([...unread, usage[field], ...runs.map((run) => run[field])])]),
  ) as Record<SummedField, TokenCount>;
  return {
    ...usage,
    ...folded,
    ...foldExtendedCacheWrite(usage, runs, unread),
    subagents: [...runs],
    ownUsage: ownUsageOf(usage),
  };
}

// Folds each turn's subagent runs into its usage (step 10.19, design §4.2;
// Claude Code, CS9: the same fold, plus the 1-hour cache writes). The summed figures become everything billed for the turn:
// own + Σ runs, unknown when any part is; cacheWrite and reasoning are thus
// known only when the turn's and every run's agent-traces join is. tool,
// vision, model and roundsCount stay the main agent's (D1); `ownUsage` keeps
// its own figures (D10). A null turn (no usable request of its own) stays
// null: a run doesn't make it known. Both maps are keyed by 0-based log turn,
// as attributeSubagentRuns returns them
// (Claude Code: the turn index, see mergeClaudeCodeSubagentUsage).
export function mergeSubagentUsage(
  turnUsages: readonly (TurnUsage | null)[],
  byLogTurn: ReadonlyMap<number, readonly SubagentRunUsage[]>,
  unreadByLogTurn: ReadonlyMap<number, string>,
): (TurnUsage | null)[] {
  return turnUsages.map((usage, logTurn) => {
    const runs = byLogTurn.get(logTurn) ?? [];
    const unreadReason = unreadByLogTurn.get(logTurn);
    if (usage === null || (runs.length === 0 && unreadReason === undefined)) {
      return usage;
    }
    return foldRuns(usage, runs, unreadReason);
  });
}
