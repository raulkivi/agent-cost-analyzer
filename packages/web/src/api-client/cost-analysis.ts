import type {
  ComparePeriod,
  CostBasisChoice,
  CostBucket,
  CostCompareGroupBy,
  CostComparison,
  CostCurrencyChoice,
  CostSeries,
  CostSeriesGroupBy,
  CostVariance,
  PricingMode,
  ProjectCost,
} from "@agent-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

// Phase 15 step 15.9: the Dashboard's Cost over time and Compare tabs, over
// GET /api/cost/timeseries and /api/cost/compare (step 15.7). Options left
// unset take the server's defaults (preferred basis, as-of-use pricing,
// native currencies, month buckets, previous period).
interface CostViewQuery {
  since?: string;
  until?: string;
  basis?: CostBasisChoice;
  pricing?: PricingMode;
  currency?: CostCurrencyChoice;
  provider?: string;
  limit?: number; // sessions per provider
}

export interface CostSeriesQuery extends CostViewQuery {
  bucket?: CostBucket;
  groupBy?: CostSeriesGroupBy;
  ids?: string[];
}

export interface CostCompareQuery extends CostViewQuery {
  since: string;
  until: string;
  groupBy: CostCompareGroupBy;
  ids: string[];
  comparePeriod?: ComparePeriod;
}

export function fetchCostTimeSeries(query: CostSeriesQuery, signal?: AbortSignal): Promise<CostSeries> {
  return getApiTransport().call<CostSeries>("getCostTimeSeries", query, signal);
}

export function fetchCostComparison(query: CostCompareQuery, signal?: AbortSignal): Promise<CostComparison> {
  return getApiTransport().call<CostComparison>("getCostComparison", query, signal);
}

// Step 15.10: the Project tab, over GET /api/cost/project and /api/cost/variance.
export interface ProjectCostQuery extends CostViewQuery {
  projectId: string;
  bucket?: CostBucket;
  topSessions?: number;
}

export interface CostVarianceQuery {
  groupBy: CostCompareGroupBy;
  id: string;
  periodA: string; // "YYYY-MM" or "YYYY-MM-DD..YYYY-MM-DD"
  periodB: string;
  currency?: CostCurrencyChoice;
  provider?: string;
  limit?: number;
}

export function fetchProjectCost(query: ProjectCostQuery, signal?: AbortSignal): Promise<ProjectCost> {
  return getApiTransport().call<ProjectCost>("getProjectCost", query, signal);
}

export function fetchCostVariance(query: CostVarianceQuery, signal?: AbortSignal): Promise<CostVariance> {
  return getApiTransport().call<CostVariance>("getCostVariance", query, signal);
}
