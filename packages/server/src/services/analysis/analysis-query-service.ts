import type { CostRollup, FindingsQueryResult, InsightsDataset, SessionCost, TurnView } from "@agent-cost-analyzer/domain";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { buildCostRollup, type CostRollupOptions } from "../cost/cost-rollup-builder.js";
import { buildSessionCost, type SessionCostOptions } from "../cost/session-cost-builder.js";
import { queryFindings, type FindingsFilter } from "../insights/findings-query.js";
import { buildTurnView, type TurnViewOptions } from "../session-view/turn-view-builder.js";
import type { ProviderLookup, SessionRangeFilter } from "../tool-audit/audit-query-service.js";

// Phase 9.12 (docs/plans/mcp-tools-v2.md §5): cost, findings and turn
// queries for the MCP server. Composes the pure builders over two narrow
// ports (DIP): one provider at a time for a session, and the dashboard's
// cross-provider dataset for rollups and findings.
export interface InsightsSource {
  getDataset(filter: SessionRangeFilter): Promise<InsightsDataset>;
}

export type TurnLookup =
  | { status: "ok"; view: TurnView }
  | { status: "unknown-session" }
  | { status: "unknown-turn"; turnCount: number };

export class AnalysisQueryService {
  constructor(
    private readonly providers: ProviderLookup,
    private readonly insights: InsightsSource,
  ) {}

  private provider(providerId?: string): LogProvider {
    return providerId ? this.providers.getProvider(providerId) : this.providers.getActiveProvider();
  }

  async getSessionCost(sessionId: string, providerId?: string, options: SessionCostOptions = {}): Promise<SessionCost | null> {
    const session = await this.provider(providerId).readSession(sessionId);
    return session ? buildSessionCost(session, options) : null;
  }

  async getCostRollup(range: SessionRangeFilter, options: CostRollupOptions = {}): Promise<CostRollup> {
    return buildCostRollup(await this.insights.getDataset(range), options);
  }

  async listFindings(range: SessionRangeFilter, filter: FindingsFilter): Promise<FindingsQueryResult> {
    return queryFindings(await this.insights.getDataset(range), filter);
  }

  async getTurn(sessionId: string, turnIndex: number, providerId?: string, options: TurnViewOptions = {}): Promise<TurnLookup> {
    const session = await this.provider(providerId).readSession(sessionId);
    if (!session) {
      return { status: "unknown-session" };
    }
    const view = buildTurnView(session, turnIndex, options);
    return view ? { status: "ok", view } : { status: "unknown-turn", turnCount: session.turns.length };
  }
}
