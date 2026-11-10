// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostRollup, FindingsQueryResult, InsightsDataset, SessionCost, TurnSeries, TurnView } from "@agent-cost-analyzer/domain";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { buildCostRollup, type CostRollupOptions } from "../cost/cost-rollup-builder.js";
import { buildTurnSeries } from "../cost/turn-series-builder.js";
import { buildSessionCost, type SessionCostOptions } from "../cost/session-cost-builder.js";
import { queryFindings, type FindingsFilter } from "../insights/findings-query.js";
import { buildTurnView, type TurnViewOptions } from "../session-view/turn-view-builder.js";
import type { ProviderLookup, SessionRangeFilter } from "../tool-audit/audit-query-service.js";
import { NOT_ATTRIBUTED, type RowAttributor } from "../insights/insights-dataset-builder.js";
import type { TurnPricing } from "../pricing/turn-cost-figures.js";
import { redactRepositoryKey } from "../cost-attribution/repository-key-privacy.js";

// Phase 9.12 (docs/plans/mcp-tools-v2.md §5): cost, findings and turn
// queries for the MCP server. Composes the pure builders over two narrow
// ports (DIP): one provider at a time for a session, and the dashboard's
// cross-provider dataset for rollups and findings.
export interface InsightsSource {
  getDataset(filter: SessionRangeFilter): Promise<InsightsDataset>;
}

// Step 15.6: one session's attribution and pricing, as the dataset does
// them (the same SessionAttributor and TurnPricer), so get_session_cost and
// get_turn agree with get_cost_rollup and the Dashboard.
export interface SessionCostSources {
  attribution?: { snapshot(): RowAttributor };
  pricer?: TurnPricing;
}

export type TurnLookup =
  | { status: "ok"; view: TurnView }
  | { status: "unknown-session" }
  | { status: "unknown-turn"; turnCount: number };

export class AnalysisQueryService {
  constructor(
    private readonly providers: ProviderLookup,
    private readonly insights: InsightsSource,
    private readonly costs: SessionCostSources = {},
    // Judges which sessions are active (docs/plans/mcp-apps.md §4.7);
    // public so the tools phrase "N minutes ago" against the same time.
    readonly now: () => Date = () => new Date(),
  ) {}

  private provider(providerId?: string): LogProvider {
    return providerId ? this.providers.getProvider(providerId) : this.providers.getActiveProvider();
  }

  async getSessionCost(sessionId: string, providerId?: string, options: SessionCostOptions = {}): Promise<SessionCost | null> {
    const provider = this.provider(providerId);
    const session = await provider.readSession(sessionId);
    if (!session) {
      return null;
    }
    const cost = buildSessionCost(session, options, {
      providerId: provider.id,
      now: this.now(),
      ...(this.costs.attribution ? { attributor: this.costs.attribution.snapshot() } : {}),
      ...(this.costs.pricer ? { pricer: this.costs.pricer.snapshot() } : {}),
    });
    // §10.1.5: MCP output names a local repository by its folder name only.
    return cost.repositoryKey ? { ...cost, repositoryKey: redactRepositoryKey(cost.repositoryKey) } : cost;
  }

  // Phase 12: the app-only get_turn_series (null for an unknown session).
  async getTurnSeries(sessionId: string, providerId?: string, maxTurns?: number): Promise<TurnSeries | null> {
    const session = await this.provider(providerId).readSession(sessionId);
    return session ? buildTurnSeries(session, maxTurns) : null;
  }

  async getCostRollup(range: SessionRangeFilter, options: CostRollupOptions = {}): Promise<CostRollup> {
    const rollup = buildCostRollup(await this.insights.getDataset(range), options, { now: this.now() });
    const byRepository = rollup.byRepository.map((group) =>
      group.key === null ? group : { ...group, key: redactRepositoryKey(group.key), label: redactRepositoryKey(group.label) },
    );
    return { ...rollup, byRepository };
  }

  async listFindings(range: SessionRangeFilter, filter: FindingsFilter): Promise<FindingsQueryResult> {
    return queryFindings(await this.insights.getDataset(range), filter);
  }

  async getTurn(sessionId: string, turnIndex: number, providerId?: string, options: TurnViewOptions = {}): Promise<TurnLookup> {
    const provider = this.provider(providerId);
    const session = await provider.readSession(sessionId);
    if (!session) {
      return { status: "unknown-session" };
    }
    const turn = session.turns.find((candidate) => candidate.index === turnIndex);
    const cost =
      turn && this.costs.pricer
        ? this.costs.pricer.snapshot().figuresFor(provider.id, session, turn, this.costs.attribution?.snapshot().turn(provider.id, session, turn) ?? NOT_ATTRIBUTED)
        : undefined;
    const view = buildTurnView(session, turnIndex, options, cost);
    return view ? { status: "ok", view } : { status: "unknown-turn", turnCount: session.turns.length };
  }
}
