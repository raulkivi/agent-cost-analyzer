import type {
  FindingKind,
  FindingSeverity,
  FindingsQueryResult,
  InsightFinding,
  InsightsDataset,
} from "@agent-cost-analyzer/domain";

// Phase 9.12 (docs/plans/mcp-tools-v2.md §4): filters and orders the
// dashboard's findings for the MCP list_findings tool. Pure.

export const DEFAULT_MAX_FINDINGS = 50;

export interface FindingsFilter {
  kind?: FindingKind[];
  minSeverity?: FindingSeverity;
  category?: string;
  sessionId?: string;
  maxResults?: number;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function mostSevereThenMostRecent(a: InsightFinding, b: InsightFinding): number {
  return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (b.at ?? "").localeCompare(a.at ?? "");
}

export function queryFindings(dataset: InsightsDataset, filter: FindingsFilter): FindingsQueryResult {
  const sessions = new Map(dataset.sessions.map((session) => [session.key, session]));
  const category = filter.category?.toLowerCase();
  const minRank = filter.minSeverity ? SEVERITY_RANK[filter.minSeverity] : 0;

  const matching = dataset.findings
    .filter(
      (finding) =>
        (!filter.kind || filter.kind.includes(finding.kind)) &&
        SEVERITY_RANK[finding.severity] >= minRank &&
        (!category || finding.category.toLowerCase() === category) &&
        (!filter.sessionId || sessions.get(finding.sessionKey)?.sessionId === filter.sessionId),
    )
    .sort(mostSevereThenMostRecent);

  const bySeverity = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const finding of matching) {
    bySeverity[finding.severity] += 1;
  }

  return {
    generatedAt: dataset.generatedAt,
    providers: dataset.providers,
    total: matching.length,
    bySeverity,
    findings: matching.slice(0, filter.maxResults ?? DEFAULT_MAX_FINDINGS).map((finding) => {
      const session = sessions.get(finding.sessionKey);
      return {
        ...finding,
        providerId: session?.providerId ?? finding.sessionKey.split(":")[0],
        sessionId: session?.sessionId ?? finding.sessionKey,
        sessionTitle: session?.title ?? "",
      };
    }),
  };
}
