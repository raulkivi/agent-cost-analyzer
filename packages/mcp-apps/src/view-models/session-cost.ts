// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SessionCost, TriggeredEvent, TurnSeries } from "@agent-cost-analyzer/domain";
import { formatAiCreditsValue } from "@agent-cost-analyzer/web/lib/format-ai-credits";
import { formatDay, formatPercent, formatTokens, measureView, pluralize, valueView } from "./format.js";
import type { MeasureView } from "./format.js";

// U1, session cost (docs/plans/mcp-apps.md §4.3, §5.5). Pure: formats a
// get_session_cost result, and optionally the app-only get_turn_series
// result, for display. No React, no host calls.
//
// `excerpt` is logged text, shown to the user in the card only. Nothing in
// this model may be put into a sendMessage (§6); those templates carry ids.

export type SessionCostTile = MeasureView;

export interface TopTurnRow {
  turnIndex: number;
  excerpt: string; // logged text: display only, never forwarded to the model
  eventLabel?: string;
  aiCredits: MeasureView;
  inputTokens: MeasureView;
}

export interface TurnPoint {
  turnIndex: number;
  value: number | null; // AI Credits; null = unknown, drawn as a hatched gap
  text: string;
  unknown: boolean;
  estimate: boolean;
  eventLabels: string[];
}

export interface TurnChart {
  points: TurnPoint[];
  maxValue: number | null; // largest known value; null when none is known
  unknownNote?: string;
  truncatedNote?: string;
}

export interface ContextOverheadView {
  // `value` is the raw count (null = unknown) so the bar can size its segments.
  systemPrompt?: { tokens: MeasureView; value: number | null; components: { label: string; tokens: MeasureView; value: number | null }[] };
  unusedToolsText?: string;
  unavailableReason?: string;
}

export interface SessionCostViewModel {
  sessionId: string;
  title: string;
  model: string;
  turnsText: string;
  startedText?: string;
  tiles: { aiCredits: SessionCostTile; inputTokens: SessionCostTile; cacheHit: SessionCostTile; output: SessionCostTile };
  chart?: TurnChart;
  topTurns: TopTurnRow[];
  contextOverhead: ContextOverheadView;
}

export function eventLabel(event: TriggeredEvent): string {
  return event.replace(/-/g, " ");
}

function buildChart(series: TurnSeries): TurnChart {
  const points = series.turns.map((turn): TurnPoint => {
    const credits = valueView(turn.aiCredits, formatAiCreditsValue);
    return {
      turnIndex: turn.turnIndex,
      value: credits.known ? turn.aiCredits : null,
      text: credits.text,
      unknown: !credits.known,
      estimate: credits.known && turn.estimated,
      eventLabels: turn.events.map(eventLabel),
    };
  });
  const known = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  const unknownCount = points.length - known.length;
  const chart: TurnChart = { points, maxValue: known.length === 0 ? null : Math.max(...known) };
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
    tiles: {
      aiCredits: measureView(cost.totals.aiCredits, formatAiCreditsValue),
      inputTokens: measureView(cost.totals.inputTokens, formatTokens),
      cacheHit: valueView(cost.cacheHitRatio, formatPercent),
      output: measureView(cost.totals.output, formatTokens),
    },
    topTurns: cost.topTurns.map((turn) => ({
      turnIndex: turn.turnIndex,
      excerpt: turn.userMessage,
      ...(turn.triggeredEvent === undefined ? {} : { eventLabel: eventLabel(turn.triggeredEvent) }),
      aiCredits: valueView(turn.aiCredits, formatAiCreditsValue),
      inputTokens: valueView(turn.inputTokens, formatTokens),
    })),
    contextOverhead: buildOverhead(cost.contextOverhead),
  };
  const startedText = formatDay(cost.startedAt);
  if (startedText !== undefined) viewModel.startedText = startedText;
  // A series for another session would draw the wrong turns.
  if (series !== undefined && series.sessionId === cost.sessionId) viewModel.chart = buildChart(series);
  return viewModel;
}

