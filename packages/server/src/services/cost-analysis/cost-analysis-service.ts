import {
  comparisonPeriod,
  type CostComparison,
  type CostSeries,
  type InsightsDataset,
  type PriceBookEntry,
  type PricingMode,
  type ProjectCost,
} from "@agent-cost-analyzer/domain";
import type { DatasetOptions } from "../insights/insights-service.js";
import type { SessionRangeFilter } from "../tool-audit/audit-query-service.js";
import { buildCostComparison } from "./comparison-builder.js";
import { buildCostCube, type CostCube } from "./cost-cube.js";
import type { CostCompareRequest, CostSeriesRequest } from "./cost-query-params.js";
import { buildProjectCost } from "./project-cost-builder.js";
import { buildCostSeries } from "./time-series-builder.js";

// Phase 15 step 15.7 (docs/plans/cost-by-repository-and-project.md §9,
// §10.1.4): the cost analyses behind GET /api/cost/timeseries and
// /api/cost/compare and the MCP tools get_repository_cost, get_project_cost
// and compare_costs. Per request it reads one cost cube (the Insights
// dataset the Dashboard uses, priced in the asked mode) and hands it to the
// pure builders, so HTTP, MCP and the Dashboard read the same numbers.
//
// Sessions are selected by their start, like every other tool (`since`/
// `until`, `provider`, `limit` per provider); turns are then bucketed and
// filtered by their own UTC date.

// The cube for a range of sessions, priced in a mode (DIP).
export interface CostCubeSource {
  getCube(range: SessionRangeFilter, pricing: PricingMode): Promise<CostCube>;
}

// The price book's versions, for the documented price-change markers.
export interface PriceVersionSource {
  list(query: Record<string, never>): { versions: PriceBookEntry[] };
}

// Project names from the projects file; undefined for an unknown id.
export interface ProjectDirectory {
  projectName(id: string): string | undefined;
}

export interface CostAnalysisDeps {
  cubes: CostCubeSource;
  priceVersions?: PriceVersionSource;
  projects?: ProjectDirectory;
}

type ViewRequest = Omit<CostSeriesRequest, "groupBy" | "ids">;
export type RepositoryCostRequest = ViewRequest & { repository: string };
export type ProjectCostRequest = ViewRequest & { projectId: string; topSessions?: number };

// The narrow interface ApiService and the MCP tools use (ISP).
export interface CostAnalysisQueries {
  getTimeSeries(request: CostSeriesRequest): Promise<CostSeries>;
  getRepositoryCost(request: RepositoryCostRequest): Promise<CostSeries>;
  getProjectCost(request: ProjectCostRequest): Promise<ProjectCost | null>;
  compare(request: CostCompareRequest): Promise<CostComparison>;
}

export interface DatasetReader {
  getDataset(filter: SessionRangeFilter, options?: DatasetOptions): Promise<InsightsDataset>;
}

export class DatasetCostCubeSource implements CostCubeSource {
  constructor(private readonly insights: DatasetReader) {}

  async getCube(range: SessionRangeFilter, pricing: PricingMode): Promise<CostCube> {
    return buildCostCube(await this.insights.getDataset(range, { pricing }));
  }
}

function rangeOf(request: { providerId?: string; limit?: number }, since?: string, until?: string): SessionRangeFilter {
  return {
    ...(request.providerId !== undefined ? { providerId: request.providerId } : {}),
    ...(request.limit !== undefined ? { limit: request.limit } : {}),
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
  };
}

// The request without the session-selection fields the builders don't read.
function withoutSelection<T extends { providerId?: string; limit?: number }>(request: T): Omit<T, "providerId" | "limit"> {
  const query: Partial<T> = { ...request };
  delete query.providerId;
  delete query.limit;
  return query as Omit<T, "providerId" | "limit">;
}

export class CostAnalysisService implements CostAnalysisQueries {
  constructor(private readonly deps: CostAnalysisDeps) {}

  async getTimeSeries(request: CostSeriesRequest): Promise<CostSeries> {
    const cube = await this.cube(request, request.since, request.until);
    return buildCostSeries(cube, withoutSelection(request), this.versions());
  }

  async getRepositoryCost(request: RepositoryCostRequest): Promise<CostSeries> {
    const { repository, ...view } = request;
    return this.getTimeSeries({ ...view, groupBy: "repository", ids: [repository] });
  }

  async getProjectCost(request: ProjectCostRequest): Promise<ProjectCost | null> {
    const projectName = this.deps.projects?.projectName(request.projectId);
    if (projectName === undefined) return null;
    const cube = await this.cube(request, request.since, request.until);
    const { projectId, topSessions, ...view } = request;
    return buildProjectCost(cube, { ...withoutSelection(view), projectId, projectName, ...(topSessions !== undefined ? { topSessions } : {}) }, this.versions());
  }

  async compare(request: CostCompareRequest): Promise<CostComparison> {
    const previous = comparisonPeriod(request.since, request.until, request.comparePeriod);
    const cube = await this.cube(request, previous.since, request.until);
    return buildCostComparison(cube, withoutSelection(request));
  }

  private async cube(request: { providerId?: string; limit?: number; pricing: PricingMode }, since?: string, until?: string): Promise<CostCube> {
    const cube = await this.deps.cubes.getCube(rangeOf(request, since, until), request.pricing);
    const projects = this.deps.projects;
    return projects ? { ...cube, projectName: (id) => projects.projectName(id) ?? cube.projectName(id) } : cube;
  }

  private versions(): PriceBookEntry[] {
    return this.deps.priceVersions?.list({}).versions ?? [];
  }
}
