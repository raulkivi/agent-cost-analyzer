// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SessionCost, TriggeredEvent, TurnSeries } from "@agent-cost-analyzer/domain";
import { formatAiCreditsValue } from "@agent-cost-analyzer/web/lib/format-ai-credits";
import { formatDay, formatPercent, formatTokens, measureView, pluralize, valueView } from "./format.js";
import type { MeasureView } from "./format.js";
import { ACTIVE_NOTE, activeView } from "./active-session.js";
import type { ActiveView } from "./active-session.js";
import { inputPartNotes, withUnknownNote } from "./input-parts.js";

// U1, session cost (docs/plans/mcp-apps.md §4.3, §5.5). Pure: formats a
// get_session_cost result, and optionally the app-only get_turn_series
// result, for display. No React, no host calls.
//
// `excerpt` is logged text, shown to the user in the card only. Nothing in
// this model may be put into a sendMessage (§6); those templates carry ids.

export type SessionCostTile = MeasureView;

import { rankingLabel } from "./ranking.js";
import type { RankedBy } from "./ranking.js";

export interface TopTurnRow {
  turnIndex: number;
  excerpt: string; // logged text: display only, never forwarded to the model
  excerptRecorded: boolean; // false: the log has no turn text; excerpt says so
  eventLabel?: string;
  aiCredits: MeasureView;
  inputTokens: MeasureView;
}

export interface TurnPoint {
  turnIndex: number;
  value: number | null; // the chart's measure; null = unknown, drawn as a hatched gap
  text: string;
  unknown: boolean;
  estimate: boolean;
  eventLabels: string[];
}

export interface TurnChart {
  points: TurnPoint[];
  maxValue: number | null; // largest known value; null when none is known
  maxText: string | null; // maxValue formatted for the y-axis, in the measure's own formatter
  title: string; // "AI Credits per turn" | "Input tokens per turn"
  unitLabel: string; // trails a value in a column title: "4.10 AI Credits"
  unknownNote?: string;
  truncatedNote?: string;
}

export interface ContextOverheadView {
  // `value` is the raw count (null = unknown) so the bar can size its segments.
  systemPrompt?: { tokens: MeasureView; value: number | null; components: { label: string; tokens: MeasureView; value: number | null }[] };
  unusedToolsText?: string;
  unavailableReason?: string;
}

export interface SessionCostViewModel extends ActiveView {
  activeNote?: string;
  sessionId: string;
  title: string;
  model: string;
  turnsText: string;
  startedText?: string;
  tiles: { aiCredits: SessionCostTile; inputTokens: SessionCostTile; cacheHit: SessionCostTile; output: SessionCostTile };
  chart?: TurnChart;
  rankedBy: RankedBy;
  chartTitle: string; // known before the series loads, so the section heading never flips
  rankingLabel: string;
  topTurns: TopTurnRow[];
  contextOverhead: ContextOverheadView;
}

export const PROMPT_NOT_RECORDED = "Prompt not recorded";

function inputTiles(cost: SessionCost): { inputTokens: SessionCostTile; cacheHit: SessionCostTile } {
  const notes = inputPartNotes(cost.totals);
  return {
    inputTokens: withUnknownNote(measureView(cost.totals.inputTokens, formatTokens), notes.inputTokens),
    cacheHit: withUnknownNote(valueView(cost.cacheHitRatio, formatPercent), notes.cacheHit),
  };
}

export function eventLabel(event: TriggeredEvent): string {
  return event.replace(/-/g, " ");
}

// Plots what the Top turns table ranks by, so a Claude Code session (no turn
// has AI Credits) shows real columns instead of a row of unknown gaps.
interface ChartMeasure {
  title: string;
  unitLabel: string;
  read: (turn: TurnSeries["turns"][number]) => number | null;
  format: (value: number) => string;
}

const CHART_MEASURES: Record<RankedBy, ChartMeasure> = {
  aiCredits: { title: "AI Credits per turn", unitLabel: "AI Credits", read: (turn) => turn.aiCredits, format: formatAiCreditsValue },
  inputTokens: { title: "Input tokens per turn", unitLabel: "input tokens", read: (turn) => turn.inputTokens, format: formatTokens },
};

function buildChart(series: TurnSeries, rankedBy: RankedBy): TurnChart {
  const measure = CHART_MEASURES[rankedBy];
  const points = series.turns.map((turn): TurnPoint => {
    const raw = measure.read(turn);
    const shown = valueView(raw, measure.format);
    return {
      turnIndex: turn.turnIndex,
      value: shown.known ? raw : null,
      text: shown.text,
      unknown: !shown.known,
      // `estimated` covers every figure on the turn (domain TurnSeries), input
      // tokens included, so it applies to both measures.
      estimate: shown.known && turn.estimated,
      eventLabels: turn.events.map(eventLabel),
    };
  });
  const known = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  const unknownCount = points.length - known.length;
  const maxValue = known.length === 0 ? null : Math.max(...known);
  const chart: TurnChart = { points, maxValue, maxText: maxValue === null ? null : measure.format(maxValue), title: measure.title, unitLabel: measure.unitLabel };
  if (unknownCount > 0) {
    chart.unknownNote = unknownCount === points.length && points.length > 1 ? `unknown for all ${points.length} turns` : `${pluralize(unknownCount, "turn")} unknown`;
  }
  if (series.truncated) chart.truncatedNote = `showing the first ${points.length} of ${series.totalTurns} turns`;
  return chart;
}

function buildOverhead(overhead: SessionCost["contextOverhead"]): ContextOverheadView {
  const view: ContextOverheadView = {};
  if (overhead.systemPrompt) {
    view.systemPrompt = {
      tokens: valueView(overhead.systemPrompt.tokens, formatTokens),
      value: overhead.systemPrompt.tokens,
      components: overhead.systemPrompt.components.map((component) => ({ label: component.label, tokens: valueView(component.tokens, formatTokens), value: component.tokens })),
    };
  }
  if (overhead.toolInventory) {
    view.unusedToolsText = `${overhead.toolInventory.neverInvokedCount} of ${overhead.toolInventory.defined} tools unused`;
  }
  if (overhead.unavailableReason !== undefined) view.unavailableReason = overhead.unavailableReason;
  return view;
}

export function toSessionCostViewModel(cost: SessionCost, series?: TurnSeries): SessionCostViewModel {
  const viewModel: SessionCostViewModel = {
    sessionId: cost.sessionId,
    title: cost.title,
    model: cost.model,
    turnsText: pluralize(cost.turnCount, "turn"),
    ...activeView(cost.active),
    ...(cost.active === true ? { activeNote: ACTIVE_NOTE } : {}),
    tiles: {
      aiCredits: measureView(cost.totals.aiCredits, formatAiCreditsValue),
      ...inputTiles(cost),
      output: measureView(cost.totals.output, formatTokens),
    },
    rankedBy: cost.rankedBy,
    chartTitle: CHART_MEASURES[cost.rankedBy].title,
    rankingLabel: rankingLabel(cost.rankedBy),
    topTurns: cost.topTurns.map((turn) => ({
      turnIndex: turn.turnIndex,
      ...(turn.userMessage.trim() === "" ? { excerpt: PROMPT_NOT_RECORDED, excerptRecorded: false } : { excerpt: turn.userMessage, excerptRecorded: true }),
      ...(turn.triggeredEvent === undefined ? {} : { eventLabel: eventLabel(turn.triggeredEvent) }),
      aiCredits: valueView(turn.aiCredits, formatAiCreditsValue),
      inputTokens: valueView(turn.inputTokens, formatTokens),
    })),
    contextOverhead: buildOverhead(cost.contextOverhead),
  };
  const startedText = formatDay(cost.startedAt);
  if (startedText !== undefined) viewModel.startedText = startedText;
  // A series for another session would draw the wrong turns.
  if (series !== undefined && series.sessionId === cost.sessionId) viewModel.chart = buildChart(series, cost.rankedBy);
  return viewModel;
}

