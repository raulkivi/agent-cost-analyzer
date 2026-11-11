// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ObservedWeek, PriceChangeList } from "@agent-cost-analyzer/domain";
import { documentedPriceChange, providerIssues } from "./analysis-common.js";
import type { DocumentedPriceChange, PriceChangeLine } from "./analysis-common.js";
import { observedMarker } from "./cost-series.js";
import type { ObservedPriceChangeMarker } from "./cost-series.js";
import { formatDay, periodText, pluralize } from "./format.js";
import { sameModel } from "./model-match.js";
import { formatMoney } from "./money.js";

// U13, price changes (docs/plans/mcp-apps.md §2, §4.5). Pure: formats a
// get_price_changes result. Documented changes (from the price book, with
// sources) and observed ones (inferred from billed vs priced) stay apart;
// an observed change is always "inferred".

// A price that moved up is a rise, down a fall; no price on either side is
// unknown, never a rise or a fall.
export type ChangeDirection = "rise" | "fall" | "flat" | "unknown";

export interface PriceLineView extends PriceChangeLine {
  direction: ChangeDirection;
}

export interface DocumentedChangeView extends DocumentedPriceChange {
  lines: PriceLineView[];
  sourceIds: string[];
  note?: string;
}

export interface ObservedWeekView {
  period: string;
  turnsText: string;
  billedText: string;
  pricedText: string;
  ratioText: string;
}

export interface ObservedChangeView extends ObservedPriceChangeMarker {
  weeks: ObservedWeekView[];
}

// Set when U11 opened the view for its largest price effects (§9.2 Q12).
export interface ModelFilterView {
  models: string[];
  shown: number;
  total: number;
  text: string;
}

export interface RangeView {
  since: string;
  until: string;
  sinceText: string;
  untilText: string;
}

export interface PriceChangesViewModel {
  periodText?: string;
  range?: RangeView; // the period asked for, when both ends were given: the timeline's axis

  filter?: ModelFilterView;
  documented: DocumentedChangeView[];
  observed: ObservedChangeView[];
  observedNote: string;
  empty: boolean;
  emptyText: string;
  issues: string[];
}

const OBSERVED_NOTE = "Observed changes are inferred from billed vs priced figures, not documented: the price book doesn't list them.";

function weekView(week: ObservedWeek): ObservedWeekView {
  return {
    period: week.period,
    turnsText: pluralize(week.turns, "turn"),
    billedText: formatMoney(week.billedAiCredits, "AI_CREDITS"),
    pricedText: formatMoney(week.pricedAiCredits, "AI_CREDITS"),
    ratioText: `${week.ratio.toFixed(2)} × the price book`,
  };
}

function directionOf(percent: number | null): ChangeDirection {
  if (percent === null) return "unknown";
  return percent > 0 ? "rise" : percent < 0 ? "fall" : "flat";
}

function joinNames(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function filterView(models: readonly string[], shown: number, total: number): ModelFilterView {
  const which = models.length === 1 ? "the model" : `the ${models.length} models`;
  return {
    models: [...models],
    shown,
    total,
    text: `Showing ${joinNames(models)}, ${which} with the largest price effect in the cost change. ${shown} of ${pluralize(total, "change")} in the range.`,
  };
}

export interface PriceChangesOptions {
  models?: readonly string[];
}

export function toPriceChangesViewModel(list: PriceChangeList, options: PriceChangesOptions = {}): PriceChangesViewModel {
  const models = options.models ?? [];
  const wanted = models.length > 0;
  const kept = wanted ? list.changes.filter((change) => models.some((model) => sameModel(model, change.modelId))) : list.changes;
  const documented: DocumentedChangeView[] = [];
  const observed: ObservedChangeView[] = [];
  for (const change of kept) {
    if (change.kind === "documented") {
      const view = documentedPriceChange(change);
      documented.push({
        ...view,
        lines: view.lines.map((line, index) => ({ ...line, direction: directionOf(change.changes[index]?.percent ?? null) })),
        sourceIds: change.sourceIds,
        ...(change.note === undefined ? {} : { note: change.note }),
      });
    } else {
      observed.push({ ...observedMarker(change), weeks: change.weeks.map(weekView) });
    }
  }
  const period = periodText(list.since, list.until);
  const total = list.changes.length;
  const emptyText = wanted && total > 0 ? `No price changes for ${joinNames(models)} in this period; ${pluralize(total, "change")} in the range ${total === 1 ? "is" : "are"} for other models` : "No price changes found in this period";
  return {
    ...(period === undefined ? {} : { periodText: period }),
    ...(list.since !== undefined && list.until !== undefined ? { range: { since: list.since, until: list.until, sinceText: formatDay(list.since) ?? list.since, untilText: formatDay(list.until) ?? list.until } } : {}),
    ...(wanted ? { filter: filterView(models, kept.length, total) } : {}),
    documented,
    observed,
    observedNote: OBSERVED_NOTE,
    empty: kept.length === 0,
    emptyText,
    issues: providerIssues(list.providers),
  };
}
