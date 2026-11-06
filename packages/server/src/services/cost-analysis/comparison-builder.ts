import {
  comparisonPeriod,
  type ComparePeriod,
  type CostChange,
  type CostCompareGroupBy,
  type CostComparison,
  type CostComparisonRow,
  type CostTotal,
  type Currency,
} from "@agent-cost-analyzer/domain";
import { cacheHitRatio, inputTokensOf } from "../cost/cost-aggregation.js";
import type { CostCube, CostCubeRow } from "./cost-cube.js";
import { coverageOf, groupingFor, groupsForIds, inDateRange, sessionCount, viewFields, viewTotal, type CostView } from "./cube-aggregation.js";

// Phase 15 step 15.7 (docs/plans/cost-by-repository-and-project.md §8.2,
// §10.1.1): the §8.2 measures for 2 to 20 repositories or projects over one
// period, against the previous period or the same dates a year earlier. A
// pure function over the cost cube. Money measures are per currency (D2: AI
// Credits and USD stay apart unless the view asks for USD), and anything
// with nothing known is null or left out, never 0.

export interface CostComparisonQuery extends CostView {
  groupBy: CostCompareGroupBy;
  ids: readonly string[];
  since: string;
  until: string;
  comparePeriod: ComparePeriod;
}

const amountIn = (total: CostTotal, currency: Currency): number | null => total.amounts.find((amount) => amount.currency === currency)?.amount ?? null;
const CURRENCIES: readonly Currency[] = ["AI_CREDITS", "USD"];

function perUnit(total: CostTotal, units: number) {
  return units === 0 ? [] : total.amounts.map((amount) => ({ currency: amount.currency, amount: amount.amount / units }));
}

function changeOf(current: CostTotal, previous: CostTotal): CostChange[] {
  return CURRENCIES.flatMap((currency): CostChange[] => {
    const now = amountIn(current, currency);
    const before = amountIn(previous, currency);
    if (now === null && before === null) return [];
    const absolute = now === null || before === null ? null : now - before;
    return [{ currency, current: now, previous: before, absolute, ratio: absolute === null || before === 0 ? null : absolute / before! }];
  });
}

// output ÷ (input + output) over the turns whose input and output are known.
function outputShare(rows: readonly CostCubeRow[]): number | null {
  let output = 0;
  let all = 0;
  for (const row of rows) {
    const input = inputTokensOf(row);
    if (input === null || row.output === null) continue;
    output += row.output;
    all += input + row.output;
  }
  return all > 0 ? output / all : null;
}

export function buildCostComparison(cube: CostCube, query: CostComparisonQuery): CostComparison {
  const previousRange = comparisonPeriod(query.since, query.until, query.comparePeriod);
  const grouping = groupingFor(query.groupBy, cube);
  const current = groupsForIds(inDateRange(cube.rows, query.since, query.until), query.ids, grouping);
  const previous = groupsForIds(inDateRange(cube.rows, previousRange.since, previousRange.until), query.ids, grouping);
  const totals = current.map((group) => viewTotal(group.rows, query));
  const all = viewTotal(current.flatMap((group) => group.rows), query);

  const rows = current.map((group, index): CostComparisonRow => {
    const total = totals[index]!;
    const before = previous[index]!.rows;
    const previousTotal = viewTotal(before, query);
    const sessions = sessionCount(group.rows);
    const activeDays = new Set(group.rows.map((row) => row.date)).size;
    return {
      key: group.key!,
      label: group.label,
      sessions,
      turns: group.rows.length,
      activeDays,
      total,
      coverage: coverageOf(group.rows),
      previous: { sessions: sessionCount(before), turns: before.length, total: previousTotal, coverage: coverageOf(before) },
      change: changeOf(total, previousTotal),
      perSession: perUnit(total, sessions),
      perActiveDay: perUnit(total, activeDays),
      perTurn: perUnit(total, group.rows.length),
      share: total.amounts.flatMap((amount) => {
        const whole = amountIn(all, amount.currency);
        return whole === null || whole === 0 ? [] : [{ currency: amount.currency, share: amount.amount / whole }];
      }),
      cacheHitRatio: cacheHitRatio(group.rows),
      outputShare: outputShare(group.rows),
    };
  });

  return {
    generatedAt: cube.generatedAt,
    since: query.since,
    until: query.until,
    comparePeriod: query.comparePeriod,
    previousSince: previousRange.since,
    previousUntil: previousRange.until,
    groupBy: query.groupBy,
    ...viewFields(query),
    providers: cube.providers,
    undatedTurns: cube.undatedTurns,
    total: all,
    rows,
  };
}
