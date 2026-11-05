import type { RepositoryList } from "@agent-cost-analyzer/domain";
import type { ProviderSource } from "../insights/insights-service.js";
import type { ProjectCatalog } from "./project-catalog.js";
import { buildRepositoryList, type ProviderSessionList } from "./repository-list-builder.js";
import type { RepositoryResolver } from "./repository-resolver.js";

// Phase 15 step 15.3: GET /api/repositories across every provider. It reads
// session summaries only (they carry `workspace` since step 15.1), so it
// never opens a whole log. Like the insights dataset, an unavailable or
// failing provider is reported in providers[], never fails the list.
export class RepositoryListService {
  constructor(
    private readonly providers: ProviderSource,
    private readonly resolver: Pick<RepositoryResolver, "resolve">,
    private readonly catalog: Pick<ProjectCatalog, "load">,
  ) {}

  async getRepositoryList(): Promise<RepositoryList> {
    const statuses: RepositoryList["providers"] = [];
    const sessions: ProviderSessionList[] = [];
    for (const provider of this.providers.listProviders()) {
      const base = { id: provider.id, label: provider.label };
      const availability = await provider.checkAvailability();
      if (!availability.available) {
        statuses.push({ ...base, available: false, ...(availability.unavailableReason ? { unavailableReason: availability.unavailableReason } : {}) });
        continue;
      }
      try {
        sessions.push({ providerId: provider.id, sessions: await provider.listSessions() });
        statuses.push({ ...base, available: true });
      } catch (error) {
        statuses.push({ ...base, available: true, error: (error as Error).message });
      }
    }
    return buildRepositoryList({
      providers: statuses,
      sessions,
      resolve: (workspace) => this.resolver.resolve(workspace),
      projects: this.catalog.load().file,
    });
  }
}
