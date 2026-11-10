// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { emptyProjectsFile, EXTENSION_NO_PROJECTS_REASON, type ProjectsState, type VendorProfile } from "@agent-cost-analyzer/domain";
import { AttributionQueryService } from "../services/cost-attribution/attribution-query-service.js";
import { RepositoryListService } from "../services/cost-attribution/repository-list-service.js";
import type { SessionAttributor } from "../services/cost-attribution/session-attributor.js";
import type { ProviderSource } from "../services/insights/insights-service.js";
import { createSessionAttributor } from "./create-session-attributor.js";

// Phase 15 step 15.13 (plan §10.1.4, D19): the extension's attribution, for
// its MCP server. Repositories, vendors and channels resolve over the
// Copilot sessions as in its Dashboard; it has no projects file, so every
// turn is in No project and list_projects says why (the reason text lives in
// domain, shared with the MCP App views).

const NO_PROJECTS: { load(): ProjectsState } = {
  load: () => ({ status: "missing", file: emptyProjectsFile(), problems: [], location: "" }),
};

export interface CopilotAttribution {
  dataset: SessionAttributor;
  queries: AttributionQueryService;
}

export function createCopilotAttribution(providers: ProviderSource, vendorProfiles: readonly VendorProfile[]): CopilotAttribution {
  const dataset = createSessionAttributor({ vendorProfiles });
  const repositories = new RepositoryListService(providers, dataset);
  return { dataset, queries: new AttributionQueryService(repositories, NO_PROJECTS, dataset, EXTENSION_NO_PROJECTS_REASON) };
}
