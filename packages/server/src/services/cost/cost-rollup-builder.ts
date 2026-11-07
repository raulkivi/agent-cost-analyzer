// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  buildCostReconciliation,
  channelLabel,
  costBasisTotals,
  type CostGroup,
  type CostRollup,
  type InsightsDataset,
  type InsightTurnRow,
} from "@agent-cost-analyzer/domain";
import { keyMatches } from "../cost-attribution/repository-key-privacy.js";
import { byCostDescending, cacheHitRatio, costFigures, costMeasures, costOf, groupBy, rankingFor, type TurnFigures } from "./cost-aggregation.js";

// Phase 9.12 (docs/plans/mcp-tools-v2.md §4.1): the dashboard's flat
// InsightsDataset (every provider) → CostRollup. Pure; reusing the same
// dataset keeps MCP answers consistent with the web Dashboard.
// Step 15.6: per-basis cost totals, breakdowns by repository, project,
// vendor and channel, Copilot reconciliation, and repository/project filters.

export const DEFAULT_TOP_SESSIONS = 10;

export interface CostRollupOptions {
  topSessions?: number;
  // Step 15.6: keep only the turns attributed to this repository key (full,
  // or redacted as an MCP tool returned it) / project.
  repository?: string;
  projectId?: string;
}

// Keep the turns the filters match (each by its own attribution) and the
// sessions that still have one; without filters, the whole dataset.
function filtered(dataset: InsightsDataset, options: CostRollupOptions): InsightsDataset {
  const { repository, projectId } = options;
  if (repository === undefined && projectId === undefined) return dataset;
  const turns = dataset.turns.filter(
    (turn) =>
      (repository === undefined || (turn.repositoryKey !== null && keyMatches(turn.repositoryKey, repository))) &&
      (projectId === undefined || turn.projectId === projectId),
  );
  const sessionKeys = new Set(turns.map((turn) => turn.sessionKey));
  return { ...dataset, turns, sessions: dataset.sessions.filter((session) => sessionKeys.has(session.key)) };
}

type GroupKey = { key: string | null; reason?: string };

// One group per value, known values by preferred USD (descending) then key,
// the unknown bucket last.
function groupsOf(
  turns: readonly InsightTurnRow[],
  keyOf: (turn: InsightTurnRow) => GroupKey,
  label: (key: string) => string,
  unknownLabel: string,
): CostGroup[] {
  const groups = new Map<string | null, { reason?: string; turns: InsightTurnRow[] }>();
  for (const turn of turns) {
    const { key, reason } = keyOf(turn);
    const group = groups.get(key) ?? { ...(reason ? { reason } : {}), turns: [] };
    group.turns.push(turn);
    groups.set(key, group);
  }
  return [...groups]
    .map(([key, group]): CostGroup => ({
      key,
      label: key === null ? unknownLabel : label(key),
      ...(key === null && group.reason ? { reason: group.reason } : {}),
      turns: group.turns.length,
      cost: costBasisTotals(group.turns.map(costOf)),
    }))
    .sort((a, b) => {
      if ((a.key === null) !== (b.key === null)) return a.key === null ? 1 : -1;
      return (b.cost.preferred.usd ?? -1) - (a.cost.preferred.usd ?? -1) || (a.key ?? "").localeCompare(b.key ?? "");
    });
}

export function buildCostRollup(source: InsightsDataset, options: CostRollupOptions = {}): CostRollup {
  const dataset = filtered(source, options);
  const turnsBySession = groupBy(dataset.turns, (turn) => turn.sessionKey);
  const turnsOf = (sessionKey: string): TurnFigures[] => turnsBySession.get(sessionKey) ?? [];
  const turnsOfSessions = (sessions: InsightsDataset["sessions"]) => sessions.flatMap((session) => turnsOf(session.key));
  const rankedBy = rankingFor(dataset.turns);
  const descending = byCostDescending(rankedBy);
  const projectNames = new Map((dataset.projects ?? []).map((project) => [project.id, project.name]));
  const vendorLabels = new Map((dataset.vendors ?? []).map((vendor) => [vendor.id, vendor.label]));

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
    cost: costBasisTotals(dataset.turns.map(costOf)),
    cacheHitRatio: cacheHitRatio(dataset.turns),
    byProvider,
    byModel,
    daily,
    rankedBy,
    topSessions,
    byRepository: groupsOf(
      dataset.turns,
      (turn) => ({ key: turn.repositoryKey, ...(turn.unattributedReason ? { reason: turn.unattributedReason } : {}) }),
      (key) => key,
      "Unattributed",
    ),
    byProject: groupsOf(dataset.turns, (turn) => ({ key: turn.projectId }), (key) => projectNames.get(key) ?? key, "No project"),
    byVendor: groupsOf(
      dataset.turns,
      (turn) => ({ key: turn.vendorId, ...(turn.vendorUnknownReason ? { reason: turn.vendorUnknownReason } : {}) }),
      (key) => vendorLabels.get(key) ?? key,
      "Unknown vendor",
    ),
    byChannel: groupsOf(
      dataset.turns,
      (turn) => ({ key: turn.channel, ...(turn.channelUnknownReason ? { reason: turn.channelUnknownReason } : {}) }),
      channelLabel,
      "Unknown channel",
    ),
    reconciliation: buildCostReconciliation(
      dataset.turns.map((turn) => ({ month: turn.date?.slice(0, 7), model: turn.model, cost: costOf(turn) })),
    ),
  };
}
