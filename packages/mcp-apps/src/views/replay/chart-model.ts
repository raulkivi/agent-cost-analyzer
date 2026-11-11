// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency } from "@agent-cost-analyzer/domain";
import { formatTick } from "@agent-cost-analyzer/web/lib/cost/cost-format";
import type { ReplayFigure, ReplayTurnRow } from "../../view-models/index.js";
import { leftInsetFor } from "../cost-over-time/chart-model.js";

// What U12's per-turn chart draws, decided apart from the SVG so the rules
// are testable (board Replay, plan §9.2 Q5). Measured is one solid line with
// filled dots, simulated one dashed line with open diamonds. A turn with no
// figure breaks the line and is never drawn as 0 (constraint 6); a run of
// turns not replayed is a hatched band, a gap, not a dip. Pure.

export interface ReplayChartPoint {
  index: number; // position along the turns
  value: number;
  title: string;
}

export interface ReplayChartGap {
  from: number; // position of the first turn not replayed in the run
  to: number;
  title: string;
}

export interface ReplayChartModel {
  unit: Currency;
  unitLabel: string;
  count: number;
  turnIndexes: number[];
  measured: ReplayChartPoint[][];
  simulated: ReplayChartPoint[][];
  gaps: ReplayChartGap[];
  max: number | null;
  peak: ReplayChartPoint | undefined; // the highest measured turn, for the chart's name
  leftInset: number;
}

const UNIT_LABEL: Record<Currency, string> = { AI_CREDITS: "AI Credits", USD: "USD" };

// Consecutive known figures make one run; an unknown one ends it.
function runs(turns: readonly ReplayTurnRow[], pick: (turn: ReplayTurnRow) => ReplayFigure, word: string): ReplayChartPoint[][] {
  const out: ReplayChartPoint[][] = [];
  let current: ReplayChartPoint[] = [];
  turns.forEach((turn, index) => {
    const figure = pick(turn);
    if (figure.amount === null) {
      if (current.length > 0) out.push(current);
      current = [];
      return;
    }
    current.push({ index, value: figure.amount, title: `Turn ${turn.turnIndex}: ${word} ${figure.text}` });
  });
  if (current.length > 0) out.push(current);
  return out;
}

function gapTitle(turns: readonly ReplayTurnRow[]): string {
  const first = turns[0]!.turnIndex;
  const last = turns[turns.length - 1]!.turnIndex;
  const label = turns.length === 1 ? `Turn ${first}` : turns.length === 2 ? `Turns ${first} and ${last}` : `Turns ${first} to ${last}`;
  const reasons = [...new Set(turns.map((turn) => turn.notReplayedReason ?? ""))];
  return `${label}: not replayed, ${reasons.length === 1 ? reasons[0] : `for ${reasons.length} reasons`}`;
}

function gapsOf(turns: readonly ReplayTurnRow[]): ReplayChartGap[] {
  const out: ReplayChartGap[] = [];
  let start: number | undefined;
  const close = (end: number) => {
    if (start !== undefined) out.push({ from: start, to: end, title: gapTitle(turns.slice(start, end + 1)) });
    start = undefined;
  };
  turns.forEach((turn, index) => {
    if (turn.replayed) close(index - 1);
    else start ??= index;
  });
  close(turns.length - 1);
  return out;
}

export function buildReplayChart(turns: readonly ReplayTurnRow[], unit: Currency): ReplayChartModel {
  const measured = runs(turns, (turn) => turn.measured, "measured");
  const simulated = runs(turns, (turn) => turn.simulated, "simulated");
  const all = [...measured, ...simulated].flat();
  const max = all.length === 0 ? null : Math.max(...all.map((point) => point.value));
  const peak = measured.flat().reduce<ReplayChartPoint | undefined>((best, point) => (best === undefined || point.value > best.value ? point : best), undefined);
  return {
    unit,
    unitLabel: UNIT_LABEL[unit],
    count: turns.length,
    turnIndexes: turns.map((turn) => turn.turnIndex),
    measured,
    simulated,
    gaps: gapsOf(turns),
    max,
    peak,
    leftInset: leftInsetFor([max === null ? "0" : formatTick(max, unit), formatTick(0, unit)]),
  };
}

// The chart's accessible name: role="img" hides each point's <title> from
// assistive tech, so the name carries the series, the size, the peak and
// the turns not replayed.
export function describeReplayChart(chart: ReplayChartModel, model: string): string {
  const parts = [`${chart.unitLabel} per turn, measured and simulated on ${model}`, `${chart.count} ${chart.count === 1 ? "turn" : "turns"}`];
  if (chart.peak === undefined && chart.max === null) parts.push("no figure known");
  if (chart.peak !== undefined) {
    const turn = chart.turnIndexes[chart.peak.index];
    parts.push(`highest measured ${chart.peak.title.replace(/^Turn \d+: measured /, "")} at turn ${turn}`);
  }
  const missed = chart.gaps.reduce((sum, gap) => sum + (gap.to - gap.from + 1), 0);
  if (missed > 0) parts.push(`${missed} ${missed === 1 ? "turn" : "turns"} not replayed`);
  return parts.join("; ");
}
