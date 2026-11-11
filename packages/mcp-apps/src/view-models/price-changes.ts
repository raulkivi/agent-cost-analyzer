// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ObservedWeek, PriceChangeList } from "@agent-cost-analyzer/domain";
import { documentedPriceChange, providerIssues } from "./analysis-common.js";
import type { DocumentedPriceChange } from "./analysis-common.js";
import { observedMarker } from "./cost-series.js";
import type { ObservedPriceChangeMarker } from "./cost-series.js";
import { periodText, pluralize } from "./format.js";
import { formatMoney } from "./money.js";

// U13, price changes (docs/plans/mcp-apps.md §2, §4.5). Pure: formats a
// get_price_changes result. Documented changes (from the price book, with
// sources) and observed ones (inferred from billed vs priced) stay apart;
// an observed change is always "inferred".

export interface DocumentedChangeView extends DocumentedPriceChange {
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

export interface PriceChangesViewModel {
  periodText?: string;
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

export function toPriceChangesViewModel(list: PriceChangeList): PriceChangesViewModel {
  const documented: DocumentedChangeView[] = [];
  const observed: ObservedChangeView[] = [];
  for (const change of list.changes) {
    if (change.kind === "documented") {
      documented.push({ ...documentedPriceChange(change), sourceIds: change.sourceIds, ...(change.note === undefined ? {} : { note: change.note }) });
    } else {
      observed.push({ ...observedMarker(change), weeks: change.weeks.map(weekView) });
    }
  }
  const period = periodText(list.since, list.until);
  return {
    ...(period === undefined ? {} : { periodText: period }),
    documented,
    observed,
    observedNote: OBSERVED_NOTE,
    empty: list.changes.length === 0,
    emptyText: "No price changes found in this period",
    issues: providerIssues(list.providers),
  };
}
