// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { unavailableTokenCount, type TokenCount, type TurnUsage } from "@agent-cost-analyzer/domain";

// Step 10.19 (classic subagents plan §4.5): a turn that ran subagents is
// billed on more than one model. Its usage splits into one part per line:
// the main agent's own (D10), then each run's, each on the model that used
// it, so the pricer and every by-model total see the right model. The parts
// sum to the turn's folded figures; where the reader folded in a run it
// could not read, an unknown "unread" line stands for it, so known lines
// never add up to a figure the turn doesn't know (constraint 6).

export interface TurnLine {
  usage: TurnUsage;
  subagent: boolean;
}

// The model of runs the reader could not read: no request of theirs was seen.
export const UNREAD_RUNS_MODEL = "unknown";

const NOT_READ_FOR_RUNS_REASON = "Tool and vision tokens are not read for subagent runs.";
const SUMMED_FIELDS = ["uncachedInput", "cacheWrite", "cacheRead", "reasoning", "output", "costAiCredits"] as const;
type SummedField = (typeof SUMMED_FIELDS)[number];

const notRead = unavailableTokenCount(NOT_READ_FOR_RUNS_REASON);

// What the folded turn holds beyond its lines: unknown wherever the turn is,
// else the remainder (0 when the lines account for all of it).
function unreadLine(usage: TurnUsage, lines: readonly TurnLine[]): TurnLine | undefined {
  const missing = SUMMED_FIELDS.some((field) => !usage[field].known && lines.every((line) => line.usage[field].known));
  if (!missing) return undefined;
  const remainder = (field: SummedField): TokenCount => {
    const total = usage[field];
    if (!total.known) return total;
    return { known: true, value: lines.reduce((rest, line) => rest - (line.usage[field] as { value: number }).value, total.value) };
  };
  return {
    subagent: true,
    usage: {
      ...(Object.fromEntries(SUMMED_FIELDS.map((field) => [field, remainder(field)])) as Record<SummedField, TokenCount>),
      tool: notRead,
      vision: notRead,
      model: UNREAD_RUNS_MODEL,
    },
  };
}

// undefined: the turn ran no subagent, so it is its own one line.
export function turnLinesOf(usage: TurnUsage): TurnLine[] | undefined {
  const { ownUsage, subagents } = usage;
  if (ownUsage === undefined || subagents === undefined) return undefined;
  const ownLine: TurnLine = {
    subagent: false,
    usage: {
      ...ownUsage,
      ...(usage.roundsCount !== undefined ? { roundsCount: usage.roundsCount } : {}),
      ...(usage.extendedCacheWrite !== undefined ? { extendedCacheWrite: usage.extendedCacheWrite } : {}),
      ...(usage.reportedCostUsd !== undefined ? { reportedCostUsd: usage.reportedCostUsd } : {}),
    },
  };
  const runLines = subagents.map(
    (run): TurnLine => ({
      subagent: true,
      usage: {
        uncachedInput: run.uncachedInput,
        cacheWrite: run.cacheWrite,
        cacheRead: run.cacheRead,
        tool: notRead,
        vision: notRead,
        reasoning: run.reasoning,
        output: run.output,
        costAiCredits: run.costAiCredits,
        model: run.model,
        roundsCount: run.roundsCount,
      },
    }),
  );
  const lines = [ownLine, ...runLines];
  const unread = unreadLine(usage, lines);
  return unread ? [...lines, unread] : lines;
}
