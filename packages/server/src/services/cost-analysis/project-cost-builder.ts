import type { PriceBookEntry, ProjectCost } from "@agent-cost-analyzer/domain";
import { measureTotal } from "../cost/cost-aggregation.js";
import type { CostCube } from "./cost-cube.js";
import { breakdownRow, coverageOf, groupingFor, groupRows, viewTotal } from "./cube-aggregation.js";
import { buildCostSeries, type CostSeriesQuery } from "./time-series-builder.js";

// Phase 15 step 15.7 (docs/plans/cost-by-repository-and-project.md §8.3,
// §10.1.1): inside one project. Its cost series (the time series grouped by
// that project, so the two always agree), plus breakdowns by repository
// member, by token type per model (what prices multiply) and its most
// expensive sessions. Vendor → model is the series' own byVendor.

export const DEFAULT_TOP_PROJECT_SESSIONS = 10;
export const MAX_TOP_PROJECT_SESSIONS = 50;

export interface ProjectCostQuery extends Omit<CostSeriesQuery, "groupBy" | "ids"> {
  projectId: string;
  projectName: string;
  topSessions?: number;
}

export function buildProjectCost(cube: CostCube, query: ProjectCostQuery, priceVersions: readonly PriceBookEntry[]): ProjectCost {
  const { projectId, projectName, topSessions, ...view } = query;
  const series = buildCostSeries(cube, { ...view, groupBy: "project", ids: [projectId] }, priceVersions);
  const grouping = groupingFor("project", cube);
  const rows = cube.rows.filter(
    (row) => grouping.matches(row, projectId) && (view.since === undefined || row.date >= view.since) && (view.until === undefined || row.date <= view.until),
  );
  const models = groupRows(rows, groupingFor("model", cube), view);
  const sessions = groupRows(rows, { ...groupingFor("model", cube), keyOf: (row) => ({ key: row.sessionKey }) }, view);

  return {
    ...series,
    project: { id: projectId, name: projectName },
    byRepository: groupRows(rows, groupingFor("repository", cube), view).map((group) => breakdownRow(group, view)),
    byTokenType: models.map((group) => ({
      model: group.label,
      vendorId: group.rows[0]!.vendorId,
      turns: group.rows.length,
      uncachedInput: measureTotal(group.rows, (row) => row.uncachedInput),
      cacheWrite: measureTotal(group.rows, (row) => row.cacheWrite),
      cacheRead: measureTotal(group.rows, (row) => row.cacheRead),
      reasoning: measureTotal(group.rows, (row) => row.reasoning),
      output: measureTotal(group.rows, (row) => row.output),
    })),
    topSessions: sessions.slice(0, Math.min(topSessions ?? DEFAULT_TOP_PROJECT_SESSIONS, MAX_TOP_PROJECT_SESSIONS)).map((group) => {
      const first = group.rows[0]!;
      return {
        providerId: first.providerId,
        sessionId: first.sessionId,
        title: first.sessionTitle,
        model: first.sessionModel,
        ...(first.sessionStartedAt !== undefined ? { startedAt: first.sessionStartedAt } : {}),
        turns: group.rows.length,
        cost: viewTotal(group.rows, view),
        coverage: coverageOf(group.rows),
      };
    }),
  };
}
