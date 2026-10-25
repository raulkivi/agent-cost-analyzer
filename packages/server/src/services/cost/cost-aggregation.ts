import type { CostFigures, CostMeasures, CostRanking, InsightTurnRow, MeasureTotal } from "@agent-cost-analyzer/domain";

// Shared, pure aggregation over flat turn rows (the dashboard's
// InsightTurnRow shape) for the session and cross-session cost builders
// (docs/plans/mcp-tools-v2.md §4.1). Unknown figures are null and are never
// summed as 0; every total reports how many turns it covers.

export type TurnFigures = Pick<
  InsightTurnRow,
  "uncachedInput" | "cacheWrite" | "cacheRead" | "reasoning" | "output" | "aiCredits" | "estimated"
>;

type Measure = (turn: TurnFigures) => number | null;

// uncached + cache write + cache read; null unless all three are known.
export function inputTokensOf(turn: TurnFigures): number | null {
  const { uncachedInput, cacheWrite, cacheRead } = turn;
  return uncachedInput === null || cacheWrite === null || cacheRead === null ? null : uncachedInput + cacheWrite + cacheRead;
}

function sumKnown(turns: readonly TurnFigures[], measure: Measure): { value: number | null; knownTurns: number; estimated: boolean } {
  let value: number | null = null;
  let knownTurns = 0;
  let estimated = false;
  for (const turn of turns) {
    const figure = measure(turn);
    if (figure !== null) {
      value = (value ?? 0) + figure;
      knownTurns += 1;
      estimated ||= turn.estimated;
    }
  }
  return { value, knownTurns, estimated };
}

export function measureTotal(turns: readonly TurnFigures[], measure: Measure): MeasureTotal {
  return { ...sumKnown(turns, measure), turns: turns.length };
}

export function costMeasures(turns: readonly TurnFigures[]): CostMeasures {
  return {
    uncachedInput: measureTotal(turns, (t) => t.uncachedInput),
    cacheWrite: measureTotal(turns, (t) => t.cacheWrite),
    cacheRead: measureTotal(turns, (t) => t.cacheRead),
    inputTokens: measureTotal(turns, inputTokensOf),
    reasoning: measureTotal(turns, (t) => t.reasoning),
    output: measureTotal(turns, (t) => t.output),
    aiCredits: measureTotal(turns, (t) => t.aiCredits),
  };
}

// cache read ÷ input tokens, over turns whose input is fully known.
export function cacheHitRatio(turns: readonly TurnFigures[]): number | null {
  let read = 0;
  let input = 0;
  for (const turn of turns) {
    const turnInput = inputTokensOf(turn);
    if (turnInput !== null) {
      read += turn.cacheRead ?? 0;
      input += turnInput;
    }
  }
  return input > 0 ? read / input : null;
}

export function costFigures(turns: readonly TurnFigures[]): CostFigures {
  return {
    turns: turns.length,
    inputTokens: sumKnown(turns, inputTokensOf).value,
    output: sumKnown(turns, (t) => t.output).value,
    aiCredits: sumKnown(turns, (t) => t.aiCredits).value,
  };
}

// AI Credits only when every turn has them — otherwise a ranking would
// silently favour whichever provider happens to record credits.
export function rankingFor(turns: readonly TurnFigures[]): CostRanking {
  return turns.length > 0 && turns.every((turn) => turn.aiCredits !== null) ? "aiCredits" : "inputTokens";
}

export function byCostDescending(ranking: CostRanking) {
  const value = (item: Pick<CostFigures, "inputTokens" | "aiCredits">) => item[ranking] ?? Number.NEGATIVE_INFINITY;
  return (a: Pick<CostFigures, "inputTokens" | "aiCredits">, b: Pick<CostFigures, "inputTokens" | "aiCredits">) => value(b) - value(a);
}

export function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}
