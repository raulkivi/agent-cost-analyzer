import type { VendorProfile } from "@agent-cost-analyzer/domain";
import { FileProjectStore } from "../data-sources/projects/file-project-store.js";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { AttributionQueryService } from "../services/cost-attribution/attribution-query-service.js";
import { ProjectCatalog } from "../services/cost-attribution/project-catalog.js";
import { RepositoryListService } from "../services/cost-attribution/repository-list-service.js";
import type { SessionAttributor } from "../services/cost-attribution/session-attributor.js";
import type { ProviderSource } from "../services/insights/insights-service.js";
import { createSessionAttributor } from "./create-session-attributor.js";

// Phase 15 step 15.4: the standalone app's attribution, over its projects
// file (projects.json beside settings.json, step 15.3). The HTTP app and
// the stdio MCP server each build one, so both read the same file the same
// way.
export interface StandaloneAttribution {
  catalog: ProjectCatalog;
  dataset: SessionAttributor;
  repositories: RepositoryListService;
  queries: AttributionQueryService;
}

export function createStandaloneAttribution(
  providers: ProviderSource,
  appSettingsDir: string,
  vendorProfiles: readonly VendorProfile[] = loadVendorProfiles(),
): StandaloneAttribution {
  const catalog = new ProjectCatalog(new FileProjectStore(appSettingsDir));
  const dataset = createSessionAttributor({ projects: catalog, vendorProfiles });
  const repositories = new RepositoryListService(providers, dataset);
  return { catalog, dataset, repositories, queries: new AttributionQueryService(repositories, catalog, dataset) };
}
