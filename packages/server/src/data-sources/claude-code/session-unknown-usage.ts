// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { unavailableTokenCount, type TokenCount, type TurnUsage } from "@agent-cost-analyzer/domain";
import { ownUsageOf } from "../jsonl/subagent-usage-merge.js";

const SUMMED_FIELDS = ["uncachedInput", "cacheWrite", "cacheRead", "reasoning", "output"] as const;

/**
 * A session-level reason (plan section 6) belongs to no turn, yet no total of
 * the session may stay known. Session totals are sums over the turns, so the
 * first turn that has usage carries the reasons as unknown token figures; every
 * other turn keeps its own. `ownUsage` keeps what the main agent used there.
 * Unknown is never 0.
 */
export function markSessionUsageUnknown(usages: readonly TurnUsage[], reasons: readonly string[]): TurnUsage[] {
  if (reasons.length === 0) return [...usages];
  const unknown = unavailableTokenCount(reasons.join(" "));
  const target = usages.findIndex((usage) => usage.roundsCount !== 0 || usage.output.known);
  const index = target === -1 ? 0 : target;

  return usages.map((usage, position) => {
    if (position !== index) return usage;
    const figures = Object.fromEntries(SUMMED_FIELDS.map((field) => [field, unknown])) as Record<(typeof SUMMED_FIELDS)[number], TokenCount>;
    return {
      ...usage,
      ...figures,
      ...(usage.extendedCacheWrite === undefined ? {} : { extendedCacheWrite: unknown }),
      ownUsage: usage.ownUsage ?? ownUsageOf(usage),
    };
  });
}
