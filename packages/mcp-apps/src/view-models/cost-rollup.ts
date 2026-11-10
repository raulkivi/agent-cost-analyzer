// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { activeView } from "./active-session.js";
import type { ActiveView } from "./active-session.js";
import type { CostRollup } from "@agent-cost-analyzer/domain";
import { formatAiCreditsValue } from "@agent-cost-analyzer/web/lib/format-ai-credits";
import { UNKNOWN_TEXT, coverageNote, formatCount, formatDay, formatPercent, formatTokens, measureView, pluralize, valueView } from "./format.js";
import type { MeasureView } from "./format.js";
import { rankingLabel } from "./ranking.js";
import type { RankedBy } from "./ranking.js";
import { inputPartNotes, withUnknownNote } from "./input-parts.js";

// U2, spend rollup (docs/plans/mcp-apps.md §4.3). Pure: formats a
// get_cost_rollup result for display. Session titles are logged text, shown
// in the card only; "Ask about this session" sends the session id (§6).

export interface ShareRow {
  label: string;
  aiCredits: MeasureView;
  shareText: string; // of the rollup's known AI Credits; "Unknown" when either side is
  share: number | null;
}

export interface DayPoint {
  date: string;
  label: string;
  value: number | null; // null = unknown, drawn as a hatched gap
  text: string;
  unknown: boolean;
}

export interface TopSessionRow extends ActiveView {
  providerId: string;
  sessionId: string;
  title: string;
  model: string;
  turnsText: string;
  startedText?: string;
  aiCredits: MeasureView;
  inputTokens: MeasureView;
}

export interface CostRollupViewModel {
  rankedBy: RankedBy;
  rankingLabel: string;
  periodText?: string;
  tiles: { aiCredits: MeasureView; sessions: MeasureView; turns: MeasureView; cacheHit: MeasureView };
  daily: { points: DayPoint[]; maxValue: number | null };
  byModel: ShareRow[];
  byProvider: ShareRow[];
  topSessions: TopSessionRow[];
}

function periodText(since: string | undefined, until: string | undefined): string | undefined {
  const from = formatDay(since);
  const to = formatDay(until);
  if (from !== undefined && to !== undefined) return `${from} – ${to}`;
  if (from !== undefined) return `since ${from}`;
  if (to !== undefined) return `until ${to}`;
  return undefined;
}

function shareRows(groups: { label: string; aiCredits: number | null }[], grandTotal: number | null): ShareRow[] {
  return groups.map((group) => {
    const aiCredits = valueView(group.aiCredits, formatAiCreditsValue);
    const share = aiCredits.known && grandTotal !== null && grandTotal > 0 ? (group.aiCredits as number) / grandTotal : null;
    return { label: group.label, aiCredits, shareText: share === null ? UNKNOWN_TEXT : formatPercent(share), share };
  });
}

export function toCostRollupViewModel(rollup: CostRollup): CostRollupViewModel {
  const grandTotal = rollup.totals.aiCredits.value;
  const days = rollup.daily.map((day): DayPoint => {
    const credits = valueView(day.aiCredits, formatAiCreditsValue);
    return { date: day.date, label: formatDay(day.date) ?? day.date, value: credits.known ? day.aiCredits : null, text: credits.text, unknown: !credits.known };
  });
  const knownDays = days.flatMap((day) => (day.value === null ? [] : [day.value]));

  const viewModel: CostRollupViewModel = {
    rankedBy: rollup.rankedBy,
    rankingLabel: rankingLabel(rollup.rankedBy),
    tiles: {
      aiCredits: measureView(rollup.totals.aiCredits, formatAiCreditsValue),
      sessions: valueView(rollup.sessionCount, formatCount),
      turns: valueView(rollup.turnCount, formatCount),
      cacheHit: withUnknownNote(valueView(rollup.cacheHitRatio, formatPercent), inputPartNotes(rollup.totals).cacheHit),
    },
    daily: { points: days, maxValue: knownDays.length === 0 ? null : Math.max(...knownDays) },
    byModel: shareRows(rollup.byModel.map((row) => ({ label: row.model, aiCredits: row.aiCredits })), grandTotal),
    byProvider: shareRows(rollup.byProvider.map((row) => ({ label: row.providerLabel, aiCredits: row.aiCredits })), grandTotal),
    topSessions: rollup.topSessions.map((session): TopSessionRow => {
      const aiCredits = valueView(session.aiCredits, formatAiCreditsValue);
      const note = aiCredits.known ? coverageNote(session.cost.knownTurns, session.cost.turns) : undefined;
      const startedText = formatDay(session.startedAt);
      return {
        providerId: session.providerId,
        sessionId: session.sessionId,
        title: session.title,
        model: session.model,
        turnsText: pluralize(session.turns, "turn"),
        ...activeView(session.active),
        ...(startedText === undefined ? {} : { startedText }),
        aiCredits: note === undefined ? aiCredits : { ...aiCredits, coverageNote: note },
        inputTokens: valueView(session.inputTokens, formatTokens),
      };
    }),
  };
  const period = periodText(rollup.since, rollup.until);
  if (period !== undefined) viewModel.periodText = period;
  return viewModel;
}
