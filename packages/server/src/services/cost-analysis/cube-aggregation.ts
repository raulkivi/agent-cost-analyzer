import {
  AI_CREDIT_CONVERSION_NOTE,
  costFigureFor,
  costInCurrency,
  sumCostFigures,
  type BasisCoverage,
  type CostBasisChoice,
  type CostBreakdownRow,
  type CostCurrencyChoice,
  type CostSeriesGroupBy,
  type CostTotal,
  type PricingMode,
} from "@agent-cost-analyzer/domain";
import { keyMatches, redactRepositoryKey } from "../cost-attribution/repository-key-privacy.js";
import type { CostCube, CostCubeRow } from "./cost-cube.js";

// Shared, pure aggregation over cost-cube rows for the step 15.7 builders
// (time series, compare, project). Unknown figures are never summed as 0;
// every total carries its coverage.

// How a view chooses and states its figures (plan §5 D3, §6.2, D2).
export interface CostView {
  basis: CostBasisChoice;
  pricing: PricingMode;
  currency: CostCurrencyChoice;
}

export function viewFields(view: CostView) {
  return { basis: view.basis, pricing: view.pricing, currency: view.currency, conversion: conversionText(view.currency) };
}

function conversionText(currency: CostCurrencyChoice): string {
  return currency === "usd" ? `Every amount is in USD: AI Credits converted at ${AI_CREDIT_CONVERSION_NOTE}` : AI_CREDIT_CONVERSION_NOTE;
}

export function viewTotal(rows: readonly CostCubeRow[], view: Pick<CostView, "basis" | "currency">): CostTotal {
  return costInCurrency(sumCostFigures(rows.map((row) => costFigureFor(row.cost, view.basis))), view.currency);
}

export function coverageOf(rows: readonly CostCubeRow[]): BasisCoverage {
  const of = (basis: CostBasisChoice) => ({ turns: rows.length, knownTurns: rows.filter((row) => costFigureFor(row.cost, basis).known).length });
  return { preferred: of("preferred"), billed: of("billed"), reported: of("reported"), priced: of("priced") };
}

export function sessionCount(rows: readonly CostCubeRow[]): number {
  return new Set(rows.map((row) => row.sessionKey)).size;
}

// Keep the rows dated inside [since, until] (inclusive ISO dates).
export function inDateRange(rows: readonly CostCubeRow[], since?: string, until?: string): CostCubeRow[] {
  return rows.filter((row) => (since === undefined || row.date >= since) && (until === undefined || row.date <= until));
}

export interface GroupKey {
  key: string | null;
  reason?: string;
}

// What a grouping reads from a row, how it labels a key, and what it calls
// the unknown bucket. Repository keys are always redacted (§10.1.5): local
// keys become the folder's name, in HTTP and MCP alike.
export interface Grouping {
  keyOf(row: CostCubeRow): GroupKey;
  matches(row: CostCubeRow, id: string): boolean;
  outputKey(key: string): string;
  label(key: string): string;
  unknownLabel: string;
}

export function groupingFor(groupBy: CostSeriesGroupBy, cube: Pick<CostCube, "projectName" | "vendorLabel">): Grouping {
  switch (groupBy) {
    case "repository":
      return {
        keyOf: (row) => ({ key: row.repositoryKey, ...(row.unattributedReason ? { reason: row.unattributedReason } : {}) }),
        matches: (row, id) => row.repositoryKey !== null && keyMatches(row.repositoryKey, id),
        outputKey: redactRepositoryKey,
        label: redactRepositoryKey,
        unknownLabel: "Unattributed",
      };
    case "project":
      return {
        keyOf: (row) => ({ key: row.projectId }),
        matches: (row, id) => row.projectId === id,
        outputKey: (key) => key,
        label: (key) => cube.projectName(key),
        unknownLabel: "No project",
      };
    case "vendor":
      return {
        keyOf: (row) => ({ key: row.vendorId, ...(row.vendorUnknownReason ? { reason: row.vendorUnknownReason } : {}) }),
        matches: (row, id) => row.vendorId === id,
        outputKey: (key) => key,
        label: (key) => cube.vendorLabel(key),
        unknownLabel: "Unknown vendor",
      };
    default:
      return {
        keyOf: (row) => ({ key: row.model }),
        matches: (row, id) => row.model === id,
        outputKey: (key) => key,
        label: (key) => key,
        unknownLabel: "Unknown model",
      };
  }
}

export interface RowGroup {
  key: string | null; // as output (redacted)
  label: string;
  reason?: string;
  rows: CostCubeRow[];
}

// One group per value; known values by the view's USD total (descending),
// then key; the unknown bucket last. Grouping is by the full key, so two
// local repositories with one folder name stay two groups.
export function groupRows(rows: readonly CostCubeRow[], grouping: Grouping, view: Pick<CostView, "basis" | "currency">): RowGroup[] {
  const groups = new Map<string | null, { reason?: string; rows: CostCubeRow[] }>();
  for (const row of rows) {
    const { key, reason } = grouping.keyOf(row);
    const group = groups.get(key) ?? { ...(reason ? { reason } : {}), rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups]
    .map(([key, group]) => ({
      key: key === null ? null : grouping.outputKey(key),
      label: key === null ? grouping.unknownLabel : grouping.label(key),
      ...(key === null && group.reason ? { reason: group.reason } : {}),
      rows: group.rows,
      usd: viewTotal(group.rows, view).usd,
      sortKey: key ?? "",
    }))
    .sort((a, b) => {
      if ((a.key === null) !== (b.key === null)) return a.key === null ? 1 : -1;
      return (b.usd ?? -1) - (a.usd ?? -1) || a.sortKey.localeCompare(b.sortKey);
    })
    .map(({ key, label, reason, rows: groupRows }) => ({ key, label, ...(reason ? { reason } : {}), rows: groupRows }));
}

// The rows each asked-for id matches, in the order asked.
export function groupsForIds(rows: readonly CostCubeRow[], ids: readonly string[], grouping: Grouping): RowGroup[] {
  return ids.map((id) => {
    const matching = rows.filter((row) => grouping.matches(row, id));
    const key = grouping.outputKey(id);
    return { key, label: grouping.label(id), rows: matching };
  });
}

export function breakdownRow(group: RowGroup, view: Pick<CostView, "basis" | "currency">): CostBreakdownRow {
  return {
    key: group.key,
    label: group.label,
    ...(group.reason ? { reason: group.reason } : {}),
    sessions: sessionCount(group.rows),
    turns: group.rows.length,
    cost: viewTotal(group.rows, view),
    coverage: coverageOf(group.rows),
  };
}
