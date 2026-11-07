// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ProjectsState } from "@agent-cost-analyzer/domain";
import {
  CostAnalysisService,
  DatasetCostCubeSource,
  type DatasetReader,
  type PriceVersionSource,
  type ProjectDirectory,
} from "../services/cost-analysis/cost-analysis-service.js";

// Phase 15 step 15.7 (plan §9): one wiring of the cost analyses for the
// standalone app's HTTP API and its stdio MCP server, over the Insights
// dataset (so the Dashboard, HTTP and MCP read the same rows), the price
// book (for price-change markers) and the projects file (project names).
export function projectDirectoryOf(catalog: { load(): Pick<ProjectsState, "file"> }): ProjectDirectory {
  return { projectName: (id) => catalog.load().file.projects.find((project) => project.id === id)?.name };
}

export function createCostAnalysis(insights: DatasetReader, priceVersions?: PriceVersionSource, projects?: ProjectDirectory, now?: () => Date): CostAnalysisService {
  return new CostAnalysisService({
    cubes: new DatasetCostCubeSource(insights),
    ...(priceVersions ? { priceVersions } : {}),
    ...(projects ? { projects } : {}),
    ...(now ? { now } : {}),
  });
}
