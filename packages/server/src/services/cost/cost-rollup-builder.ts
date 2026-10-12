import type { CostRollup, InsightsDataset } from "@copilot-cost-analyzer/domain";
import { byCostDescending, cacheHitRatio, costFigures, costMeasures, groupBy, rankingFor, type TurnFigures } from "./cost-aggregation.js";

// Phase 9.12 (docs/plans/mcp-tools-v2.md §4.1): the dashboard's flat
// InsightsDataset (every provider) → CostRollup. Pure; reusing the same
// dataset keeps MCP answers consistent with the web Dashboard.

export const DEFAULT_TOP_SESSIONS = 10;

export interface CostRollupOptions {
  topSessions?: number;
}

export function buildCostRollup(dataset: InsightsDataset, options: CostRollupOptions = {}): CostRollup {
  const turnsBySession = groupBy(dataset.turns, (turn) => turn.sessionKey);
  const turnsOf = (sessionKey: string): TurnFigures[] => turnsBySession.get(sessionKey) ?? [];
  const turnsOfSessions = (sessions: InsightsDataset["sessions"]) => sessions.flatMap((session) => turnsOf(session.key));
  const rankedBy = rankingFor(dataset.turns);
  const descending = byCostDescending(rankedBy);

  const byProvider = [...groupBy(dataset.sessions, (session) => session.providerId)]
    .map(([providerId, sessions]) => ({
      providerId,
      providerLabel: sessions[0].providerLabel,
      sessions: sessions.length,
      ...costFigures(turnsOfSessions(sessions)),
    }))
    .sort(descending);

  const byModel = [...groupBy(dataset.turns, (turn) => turn.model)]
    .map(([model, turns]) => ({ model, ...costFigures(turns) }))
    .sort(descending);

  const daily = [...groupBy(dataset.sessions.filter((session) => session.date), (session) => session.date!)]
    .map(([date, sessions]) => ({ date, sessions: sessions.length, ...costFigures(turnsOfSessions(sessions)) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const topSessions = dataset.sessions
    .map((session) => ({
      providerId: session.providerId,
      sessionId: session.sessionId,
      title: session.title,
      model: session.model,
      ...(session.startedAt ? { startedAt: session.startedAt } : {}),
      ...costFigures(turnsOf(session.key)),
    }))
    .sort(descending)
    .slice(0, options.topSessions ?? DEFAULT_TOP_SESSIONS);

  return {
    generatedAt: dataset.generatedAt,
    ...(dataset.since ? { since: dataset.since } : {}),
    ...(dataset.until ? { until: dataset.until } : {}),
    providers: dataset.providers,
    sessionCount: dataset.sessions.length,
    turnCount: dataset.turns.length,
    totals: costMeasures(dataset.turns),
    cacheHitRatio: cacheHitRatio(dataset.turns),
    byProvider,
    byModel,
    daily,
    rankedBy,
    topSessions,
  };
}
