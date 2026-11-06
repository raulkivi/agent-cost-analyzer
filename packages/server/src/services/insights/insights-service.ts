import type { InsightProviderStatus, InsightsDataset } from "@agent-cost-analyzer/domain";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { UnknownLogProviderIdError } from "../../data-sources/log-providers/registry.js";
import { DEFAULT_ROLLUP_SESSION_LIMIT, inRange, MAX_ROLLUP_SESSION_LIMIT, type SessionRangeFilter } from "../tool-audit/audit-query-service.js";
import type { FindingDetector } from "./finding-detector.js";
import type { AttributionSnapshot } from "../cost-attribution/session-attributor.js";
import { buildInsightRows, type InsightRows, type ProviderSessions, type RowAttributor } from "./insights-dataset-builder.js";
import type { TurnPricing } from "../pricing/turn-cost-figures.js";

// The narrow slice of LogProviderRegistry this service needs (DIP).
export interface ProviderSource {
  listProviders(): LogProvider[];
}

// Step 15.4: attribution against one read of the projects file per dataset
// (SessionAttributor satisfies it). Absent, rows say attribution is not
// configured.
export interface DatasetAttribution {
  snapshot(): RowAttributor & Pick<AttributionSnapshot, "projectName" | "vendorLabel">;
}

interface ProviderLoad {
  status: InsightProviderStatus;
  sessions?: ProviderSessions;
}

// Phase 9.11 (docs/plans/insights-dashboard.md §4): loads the most recent
// sessions from every provider (or one, with providerId), flattens them and
// runs the injected finding detectors. A provider that is unavailable or
// fails is reported in providers[] — it never fails the whole dataset.
// Display names for the project and vendor ids the rows use.
function labelsOf(rows: InsightRows, snapshot: Pick<AttributionSnapshot, "projectName" | "vendorLabel">) {
  const all = [...rows.sessions, ...rows.turns];
  const projectIds = [...new Set(all.flatMap((row) => (row.projectId ? [row.projectId] : [])))].sort();
  const vendorIds = [...new Set(all.flatMap((row) => (row.vendorId ? [row.vendorId] : [])))].sort();
  return {
    projects: projectIds.map((id) => ({ id, name: snapshot.projectName(id) ?? id })),
    vendors: vendorIds.map((id) => ({ id, label: snapshot.vendorLabel(id) })),
  };
}

export class InsightsService {
  constructor(
    private readonly providers: ProviderSource,
    private readonly detectors: readonly FindingDetector[],
    private readonly now: () => Date = () => new Date(),
    private readonly attribution?: DatasetAttribution,
    // Step 15.6: the priced basis (TurnCostFigureBuilder over the price
    // book). Absent, priced figures are unknown with the reason.
    private readonly pricer?: TurnPricing,
  ) {}

  async getDataset(filter: SessionRangeFilter): Promise<InsightsDataset> {
    const selected = this.selectProviders(filter.providerId);
    const limit = Math.min(filter.limit ?? DEFAULT_ROLLUP_SESSION_LIMIT, MAX_ROLLUP_SESSION_LIMIT);
    const loads = await Promise.all(selected.map((provider) => this.load(provider, filter, limit)));
    const sources = loads.flatMap((load) => (load.sessions ? [load.sessions] : []));
    const snapshot = this.attribution?.snapshot();
    const rows = buildInsightRows(sources, snapshot, this.pricer?.snapshot());
    return {
      generatedAt: this.now().toISOString(),
      ...(filter.since ? { since: filter.since } : {}),
      ...(filter.until ? { until: filter.until } : {}),
      providers: loads.map((load) => load.status),
      ...rows,
      findings: this.detectors.flatMap((detector) => detector.detect({ sources, rows })),
      ...(snapshot ? labelsOf(rows, snapshot) : {}),
    };
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

  private async load(provider: LogProvider, filter: SessionRangeFilter, limit: number): Promise<ProviderLoad> {
    const base = { id: provider.id, label: provider.label, sessionCount: 0, truncated: false };
    const availability = await provider.checkAvailability();
    if (!availability.available) {
      return {
        status: {
          ...base,
          available: false,
          ...(availability.unavailableReason ? { unavailableReason: availability.unavailableReason } : {}),
        },
      };
    }
    try {
      const matching = (await provider.listSessions())
        .filter((session) => inRange(session.startedAt, filter.since, filter.until))
        .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
      const sessions = [];
      // Sequential on purpose (as in the audit rollup): each readSession can
      // parse a large log file.
      for (const summary of matching.slice(0, limit)) {
        const session = await provider.readSession(summary.id);
        if (session) {
          sessions.push(session);
        }
      }
      return {
        status: { ...base, available: true, sessionCount: sessions.length, truncated: matching.length > limit },
        sessions: { providerId: provider.id, providerLabel: provider.label, sessions },
      };
    } catch (error) {
      return { status: { ...base, available: true, error: (error as Error).message } };
    }
  }
}
