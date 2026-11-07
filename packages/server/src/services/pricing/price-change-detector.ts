// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  addDays,
  bucketOf,
  documentedPriceChanges,
  OBSERVED_CHANGE_MIN_TURNS,
  OBSERVED_CHANGE_MIN_WEEKS,
  OBSERVED_CHANGE_THRESHOLD,
  type AnyPriceChange,
  type ObservedPriceChange,
  type ObservedWeek,
  type PriceBookEntry,
  type PriceChangeRange,
  type TurnCostFigures,
} from "@agent-cost-analyzer/domain";

// Phase 15 step 15.10 (docs/plans/cost-by-repository-and-project.md §6.4,
// D11): the two kinds of price change, kept apart.
//
// 1. Documented: a boundary between two price-book versions (the step 15.7
//    markers, documentedPriceChanges).
// 2. Observed (Copilot): per model and ISO week, billed ÷ priced AI Credits
//    over the turns that have both. A run of 2+ weeks in a row, each with
//    20+ such turns and more than 5% away from 1 the same way, is one
//    observed change. It is `inferred`: a prompt to check the price book.
//
// Pure: the caller supplies the versions and the turns.

export interface ObservedTurn {
  date: string; // YYYY-MM-DD (UTC)
  model: string;
  channel: string | null;
  sessionKey: string;
  cost: TurnCostFigures;
}

export interface PriceChangeFilter {
  since?: string;
  until?: string;
  channel?: string;
  model?: string;
  kind?: "documented" | "observed";
}

interface WeekTotals extends ObservedWeek {
  versions: Set<string>;
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

function directionOf(week: ObservedWeek): "above" | "below" | null {
  if (week.turns < OBSERVED_CHANGE_MIN_TURNS || week.pricedAiCredits <= 0) return null;
  if (week.ratio > 1 + OBSERVED_CHANGE_THRESHOLD) return "above";
  if (week.ratio < 1 - OBSERVED_CHANGE_THRESHOLD) return "below";
  return null;
}

const nextWeekStart = (week: ObservedWeek) => addDays(week.end, 1);

function weeksOf(turns: readonly ObservedTurn[]): Map<string, { channel: string; model: string; weeks: WeekTotals[] }> {
  const groups = new Map<string, { channel: string; model: string; weeks: Map<string, WeekTotals> }>();
  for (const turn of turns) {
    const { billed, priced } = turn.cost;
    if (turn.channel === null || !billed.known || billed.currency !== "AI_CREDITS" || !priced.known || priced.currency !== "AI_CREDITS") continue;
    const key = JSON.stringify([turn.channel, turn.model]);
    const group = groups.get(key) ?? { channel: turn.channel, model: turn.model, weeks: new Map<string, WeekTotals>() };
    const bucket = bucketOf(turn.date, "week");
    const week = group.weeks.get(bucket.period) ?? { ...bucket, turns: 0, billedAiCredits: 0, pricedAiCredits: 0, ratio: 0, versions: new Set<string>() };
    week.turns += 1;
    week.billedAiCredits += billed.amount;
    week.pricedAiCredits += priced.amount;
    for (const id of priced.priceVersionIds ?? []) week.versions.add(id);
    group.weeks.set(bucket.period, week);
    groups.set(key, group);
  }
  const result = new Map<string, { channel: string; model: string; weeks: WeekTotals[] }>();
  for (const [key, group] of groups) {
    const weeks = [...group.weeks.values()].sort((a, b) => a.start.localeCompare(b.start));
    for (const week of weeks) {
      week.billedAiCredits = round(week.billedAiCredits, 9);
      week.pricedAiCredits = round(week.pricedAiCredits, 9);
      week.ratio = week.pricedAiCredits > 0 ? round(week.billedAiCredits / week.pricedAiCredits, 6) : 0;
    }
    result.set(key, { channel: group.channel, model: group.model, weeks });
  }
  return result;
}

function toChange(channel: string, model: string, run: WeekTotals[], direction: "above" | "below"): ObservedPriceChange {
  const billed = run.reduce((sum, week) => sum + week.billedAiCredits, 0);
  const pricedTotal = run.reduce((sum, week) => sum + week.pricedAiCredits, 0);
  return {
    kind: "observed",
    date: run[0]!.start,
    channel,
    modelId: model,
    direction,
    percent: round(((billed - pricedTotal) / pricedTotal) * 100, 2),
    weeks: run.map((week) => ({ period: week.period, start: week.start, end: week.end, turns: week.turns, billedAiCredits: week.billedAiCredits, pricedAiCredits: week.pricedAiCredits, ratio: week.ratio })),
    priceVersionIds: [...new Set(run.flatMap((week) => [...week.versions]))].sort(),
    confidence: "inferred",
  };
}

export class PriceChangeDetector {
  observed(turns: readonly ObservedTurn[], range: PriceChangeRange = {}): ObservedPriceChange[] {
    const wanted = range.pairs ? new Set(range.pairs.map((pair) => JSON.stringify([pair.channel, pair.modelId]))) : undefined;
    const changes: ObservedPriceChange[] = [];
    for (const [key, { channel, model, weeks }] of weeksOf(turns)) {
      if (wanted && !wanted.has(key)) continue;
      let run: WeekTotals[] = [];
      let runDirection: "above" | "below" | null = null;
      const close = () => {
        if (runDirection !== null && run.length >= OBSERVED_CHANGE_MIN_WEEKS) changes.push(toChange(channel, model, run, runDirection));
        run = [];
        runDirection = null;
      };
      for (const week of weeks) {
        const direction = directionOf(week);
        const continues = run.length > 0 && direction === runDirection && nextWeekStart(run.at(-1)!) === week.start;
        if (!continues) close();
        if (direction !== null) {
          run.push(week);
          runDirection = direction;
        }
      }
      close();
    }
    return changes
      .filter((change) => (range.since === undefined || change.date >= range.since) && (range.until === undefined || change.date <= range.until))
      .sort((a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel) || a.modelId.localeCompare(b.modelId));
  }

  // get_price_changes: both kinds, oldest first.
  list(input: { versions: readonly PriceBookEntry[]; turns: readonly ObservedTurn[] }, filter: PriceChangeFilter = {}): AnyPriceChange[] {
    const range: PriceChangeRange = { ...(filter.since ? { since: filter.since } : {}), ...(filter.until ? { until: filter.until } : {}) };
    const keep = (change: { channel: string; modelId: string }) =>
      (filter.channel === undefined || change.channel === filter.channel) && (filter.model === undefined || change.modelId === filter.model);
    const documented = filter.kind === "observed" ? [] : documentedPriceChanges(input.versions, range).filter(keep);
    const observed = filter.kind === "documented" ? [] : this.observed(input.turns, range).filter(keep);
    return [...documented, ...observed].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  }
}
