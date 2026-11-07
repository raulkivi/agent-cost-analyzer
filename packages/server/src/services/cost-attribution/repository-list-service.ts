// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { RepositoryList } from "@agent-cost-analyzer/domain";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { UnknownLogProviderIdError } from "../../data-sources/log-providers/registry.js";
import type { ProviderSource } from "../insights/insights-service.js";
import { inRange } from "../tool-audit/audit-query-service.js";
import { buildRepositoryList, type ProviderSessionList } from "./repository-list-builder.js";
import type { AttributionSnapshot } from "./session-attributor.js";

// What the list needs from SessionAttributor (DIP).
export interface RepositoryListAttribution {
  snapshot(): Pick<AttributionSnapshot, "repository" | "projectsFile">;
}

export interface RepositoryListFilter {
  providerId?: string;
  // ISO dates/timestamps, inclusive, against each session's start.
  since?: string;
  until?: string;
}

// Phase 15 step 15.3: GET /api/repositories across every provider. It reads
// session summaries only (they carry `workspace` since step 15.1), so it
// never opens a whole log. Like the insights dataset, an unavailable or
// failing provider is reported in providers[], never fails the list. Step
// 15.4: one provider and a date window can be picked (MCP list_repositories).
export class RepositoryListService {
  constructor(
    private readonly providers: ProviderSource,
    private readonly attribution: RepositoryListAttribution,
  ) {}

  async getRepositoryList(filter: RepositoryListFilter = {}): Promise<RepositoryList> {
    const statuses: RepositoryList["providers"] = [];
    const sessions: ProviderSessionList[] = [];
    for (const provider of this.selectProviders(filter.providerId)) {
      const base = { id: provider.id, label: provider.label };
      const availability = await provider.checkAvailability();
      if (!availability.available) {
        statuses.push({ ...base, available: false, ...(availability.unavailableReason ? { unavailableReason: availability.unavailableReason } : {}) });
        continue;
      }
      try {
        const listed = await provider.listSessions();
        sessions.push({ providerId: provider.id, sessions: listed.filter((session) => inRange(session.startedAt, filter.since, filter.until)) });
        statuses.push({ ...base, available: true });
      } catch (error) {
        statuses.push({ ...base, available: true, error: (error as Error).message });
      }
    }
    const snapshot = this.attribution.snapshot();
    return buildRepositoryList({
      providers: statuses,
      sessions,
      repositoryOf: (session) => snapshot.repository(session),
      projects: snapshot.projectsFile,
    });
  }

  private selectProviders(providerId: string | undefined): LogProvider[] {
    const all = this.providers.listProviders();
    if (providerId === undefined) {
      return all;
    }
    const match = all.filter((provider) => provider.id === providerId);
    if (match.length === 0) {
      throw new UnknownLogProviderIdError(providerId);
    }
    return match;
  }
}
