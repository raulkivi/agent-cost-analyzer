// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Session, TurnSeries } from "@agent-cost-analyzer/domain";
import { buildInsightRows } from "../insights/insights-dataset-builder.js";
import { inputTokensOf } from "./cost-aggregation.js";

// Phase 12 (docs/plans/mcp-apps.md §4.2): Session → TurnSeries, the bounded
// per-turn figures behind the app-only `get_turn_series` tool. Pure. Figures
// come from the same insight rows as buildSessionCost, so both agree.

export const DEFAULT_MAX_TURNS = 500;
export const MAX_TURNS_LIMIT = 2000;

function clampMaxTurns(maxTurns: number): number {
  const whole = Number.isFinite(maxTurns) ? Math.floor(maxTurns) : DEFAULT_MAX_TURNS;
  return Math.min(MAX_TURNS_LIMIT, Math.max(1, whole));
}

export function buildTurnSeries(session: Session, maxTurns: number = DEFAULT_MAX_TURNS): TurnSeries {
  const limit = clampMaxTurns(maxTurns);
  const kept = session.turns.slice(0, limit);
  const { turns: rows } = buildInsightRows([{ providerId: session.providerId ?? "", providerLabel: "", sessions: [{ ...session, turns: kept }] }]);
  const startedAtByIndex = new Map(kept.map((turn) => [turn.index, turn.startedAt]));

  return {
    sessionId: session.id,
    turns: rows.map((row) => {
      const startedAt = startedAtByIndex.get(row.turnIndex);
      return {
        turnIndex: row.turnIndex,
        ...(startedAt ? { startedAt } : {}),
        model: row.model,
        aiCredits: row.aiCredits,
        inputTokens: inputTokensOf(row),
        cacheRead: row.cacheRead,
        output: row.output,
        estimated: row.estimated,
        events: row.triggeredEvent ? [row.triggeredEvent] : [],
      };
    }),
    totalTurns: session.turns.length,
    truncated: session.turns.length > kept.length,
  };
}
