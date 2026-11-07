// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  addCostTotals,
  bucketOf,
  bucketsBetween,
  costBasisTotals,
  documentedPriceChanges,
  type CostBucket,
  type CostPoint,
  type CostSeries,
  type CostSeriesGroupBy,
  type PriceBookEntry,
  type PriceChangeMarker,
  type VendorCostBreakdown,
} from "@agent-cost-analyzer/domain";
import type { CostCube, CostCubeRow } from "./cost-cube.js";
import {
  breakdownRow,
  coverageOf,
  groupingFor,
  groupRows,
  groupsForIds,
  inDateRange,
  sessionCount,
  viewFields,
  viewTotal,
  type CostView,
} from "./cube-aggregation.js";

// Phase 15 step 15.7 (docs/plans/cost-by-repository-and-project.md §8.1,
// §10.1.1): cost over time. A pure function over the cost cube: the rows in
// [since, until] (by each turn's own UTC date), optionally narrowed to some
// repositories, projects, vendors or models, bucketed by day, ISO week or
// month. Every bucket in the range is a point, so an unknown bucket (turns,
// nothing known) is a gap with its coverage and an idle one has no turns.

export interface CostSeriesQuery extends CostView {
  bucket: CostBucket;
  since?: string;
  until?: string;
  groupBy?: CostSeriesGroupBy;
  ids?: readonly string[];
}

function pointsOf(rows: readonly CostCubeRow[], range: { from: string; to: string } | undefined, query: CostSeriesQuery): CostPoint[] {
  if (range === undefined) return [];
  const byPeriod = new Map<string, CostCubeRow[]>();
  for (const row of rows) {
    const period = bucketOf(row.date, query.bucket).period;
    byPeriod.set(period, [...(byPeriod.get(period) ?? []), row]);
  }
  let cumulative = viewTotal([], query);
  return bucketsBetween(range.from, range.to, query.bucket).map((bucket) => {
    const inBucket = byPeriod.get(bucket.period) ?? [];
    const cost = viewTotal(inBucket, query);
    cumulative = addCostTotals(cumulative, cost);
    return { ...bucket, sessions: sessionCount(inBucket), turns: inBucket.length, cost, cumulative, coverage: coverageOf(inBucket) };
  });
}

function rangeOf(rows: readonly CostCubeRow[], since?: string, until?: string): { from: string; to: string } | undefined {
  const dates = rows.map((row) => row.date).sort();
  const from = since ?? dates[0];
  const to = until ?? dates.at(-1);
  return from === undefined || to === undefined ? undefined : { from, to };
}

function byVendor(rows: readonly CostCubeRow[], cube: CostCube, view: CostView): VendorCostBreakdown[] {
  const models = groupingFor("model", cube);
  return groupRows(rows, groupingFor("vendor", cube), view).map((vendor) => ({
    ...breakdownRow(vendor, view),
    models: groupRows(vendor.rows, models, view).map((model) => breakdownRow(model, view)),
  }));
}

// Markers for the channel/model pairs the rows were priced with, in range.
export function priceChangesFor(rows: readonly CostCubeRow[], priceVersions: readonly PriceBookEntry[], range: { from: string; to: string } | undefined): PriceChangeMarker[] {
  if (range === undefined) return [];
  const byId = new Map(priceVersions.map((version) => [version.id, version]));
  const pairs = new Map<string, { channel: string; modelId: string }>();
  for (const row of rows) {
    const figure = row.cost.priced;
    for (const id of figure.known ? (figure.priceVersionIds ?? []) : []) {
      const version = byId.get(id);
      if (version) pairs.set(JSON.stringify([version.channel, version.modelId]), { channel: version.channel, modelId: version.modelId });
    }
  }
  if (pairs.size === 0) return [];
  return documentedPriceChanges(priceVersions, { since: range.from, until: range.to, pairs: [...pairs.values()] });
}

export function buildCostSeries(cube: CostCube, query: CostSeriesQuery, priceVersions: readonly PriceBookEntry[]): CostSeries {
  const dated = inDateRange(cube.rows, query.since, query.until);
  const grouping = query.groupBy ? groupingFor(query.groupBy, cube) : undefined;
  const groups = grouping === undefined ? [] : query.ids && query.ids.length > 0 ? groupsForIds(dated, query.ids, grouping) : groupRows(dated, grouping, query);
  const selected = grouping && query.ids && query.ids.length > 0 ? groups.flatMap((group) => group.rows) : dated;
  const range = rangeOf(selected, query.since, query.until);

  return {
    generatedAt: cube.generatedAt,
    ...(query.since ? { since: query.since } : {}),
    ...(query.until ? { until: query.until } : {}),
    ...viewFields(query),
    bucket: query.bucket,
    ...(query.groupBy ? { groupBy: query.groupBy } : {}),
    ...(query.ids && query.ids.length > 0 ? { ids: grouping ? query.ids.map((id) => grouping.outputKey(id)) : [...query.ids] } : {}),
    providers: cube.providers,
    sessions: sessionCount(selected),
    turns: selected.length,
    undatedTurns: cube.undatedTurns,
    total: viewTotal(selected, query),
    totals: costBasisTotals(selected.map((row) => row.cost)),
    points: pointsOf(selected, range, query),
    series: groups.map((group) => ({
      key: group.key,
      label: group.label,
      ...(group.reason ? { reason: group.reason } : {}),
      sessions: sessionCount(group.rows),
      turns: group.rows.length,
      total: viewTotal(group.rows, query),
      coverage: coverageOf(group.rows),
      points: pointsOf(group.rows, range, query),
    })),
    byVendor: byVendor(selected, cube, query),
    priceChanges: priceChangesFor(selected, priceVersions, range),
  };
}
