import {
  addDays,
  AI_CREDIT_CONVERSION_NOTE,
  MIN_ESTIMATE_UNITS,
  percentile,
  toUsd,
  type CostEstimate,
  type EstimateUnit,
} from "@agent-cost-analyzer/domain";
import type { CostFigure } from "@agent-cost-analyzer/domain";
import type { CostCube, CostCubeRow } from "../cost-analysis/cost-cube.js";
import { groupingFor } from "../cost-analysis/cube-aggregation.js";

// Phase 15 step 15.12 (docs/plans/cost-by-repository-and-project.md §8.6,
// D16–D18): an estimate from a project's (or repository's) history, a pure
// function over a cost cube priced at today's prices. The history is the
// trailing window of whole UTC days ending today. A unit (an active day or
// a session) counts only when every turn in it has a priced figure; its cost
// is their sum in USD (AI Credits at $0.01, D2). The range is the median and
// 90th-percentile unit cost × the planned units (D16); under
// MIN_ESTIMATE_UNITS known units there is no range, only why (D18).

export interface EstimateQuery {
  target: CostEstimate["target"];
  unit: EstimateUnit;
  planned: number;
  weeks: 4 | 12;
  now: Date;
}

const round = (value: number) => Math.round(value * 1e9) / 1e9;

interface Unit {
  rows: CostCubeRow[];
  known: boolean;
  usd: number;
}

// The figure a turn is estimated from: its priced one (at today's prices),
// or, on another model, its simulated one (Phase 14 step 14.5).
export type EstimateFigureOf = (row: CostCubeRow) => CostFigure;
const pricedFigure: EstimateFigureOf = (row) => row.cost.priced;

function unitsOf(rows: readonly CostCubeRow[], keyOf: (row: CostCubeRow) => string, figureOf: EstimateFigureOf): Unit[] {
  const groups = new Map<string, CostCubeRow[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return [...groups.values()].map((members) => {
    const figures = members.map(figureOf);
    const known = figures.every((figure) => figure.known);
    return { rows: members, known, usd: known ? figures.reduce((sum, figure) => sum + (toUsd(figure) ?? 0), 0) : 0 };
  });
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function windowOf(query: Pick<EstimateQuery, "now" | "weeks">): { since: string; until: string } {
  const until = query.now.toISOString().slice(0, 10);
  return { since: addDays(until, -(query.weeks * 7 - 1)), until };
}

// The target's turns in the history window, the rows an estimate reads.
export function estimateRows(cube: CostCube, query: Pick<EstimateQuery, "target" | "now" | "weeks">): CostCubeRow[] {
  const { since, until } = windowOf(query);
  const grouping = groupingFor(query.target.groupBy, cube);
  return cube.rows.filter((row) => grouping.matches(row, query.target.id) && row.date >= since && row.date <= until);
}

export function buildCostEstimate(cube: CostCube, query: EstimateQuery, figureOf: EstimateFigureOf = pricedFigure): CostEstimate {
  const { since, until } = windowOf(query);
  const rows = estimateRows(cube, query);

  const days = unitsOf(rows, (row) => row.date, figureOf);
  const units = query.unit === "activeDays" ? days : unitsOf(rows, (row) => row.sessionKey, figureOf);
  const known = units.filter((unit) => unit.known);
  const knownDays = days.filter((unit) => unit.known);
  const totalUsd = round(known.reduce((sum, unit) => sum + unit.usd, 0));
  const knownDaysUsd = knownDays.reduce((sum, unit) => sum + unit.usd, 0);

  const base = {
    label: "estimate" as const,
    generatedAt: cube.generatedAt,
    target: query.target,
    pricing: "today" as const,
    currency: "USD" as const,
    conversion: `Every amount is in USD at today's prices: AI Credits converted at ${AI_CREDIT_CONVERSION_NOTE}`,
    window: { weeks: query.weeks, since, until },
    unit: query.unit,
    planned: query.planned,
    history: { units: units.length, knownUnits: known.length, turns: rows.length, totalUsd },
    runRate: { perActiveDayUsd: knownDays.length > 0 ? round(knownDaysUsd / knownDays.length) : null, perWeekUsd: round(knownDaysUsd / query.weeks) },
  };

  if (known.length < MIN_ESTIMATE_UNITS) {
    const noun = query.unit === "activeDays" ? ["active day", "active days"] : ["session", "sessions"];
    const unknown = units.length - known.length;
    const more = unknown > 0 ? ` ${plural(unknown, `more ${noun[0]}`, `more ${noun[1]}`)} had a turn with no price.` : "";
    return {
      ...base,
      unitCost: null,
      range: null,
      refusal: `Only ${plural(known.length, noun[0]!, noun[1]!)} with a known cost in the last ${query.weeks} weeks; an estimate needs at least ${MIN_ESTIMATE_UNITS}.${more}`,
    };
  }
  const costs = known.map((unit) => unit.usd);
  const p50 = round(percentile(costs, 0.5));
  const p90 = round(percentile(costs, 0.9));
  return { ...base, unitCost: { p50, p90 }, range: { p50: round(p50 * query.planned), p90: round(p90 * query.planned) } };
}
