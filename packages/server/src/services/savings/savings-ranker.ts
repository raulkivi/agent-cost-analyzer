// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  savingsOpportunityKindSchema,
  USD_PER_AI_CREDIT,
  type PricingMode,
  type SavingsAmount,
  type SavingsNotAnalysed,
  type SavingsOpportunity,
  type SavingsReport,
  type SavingsWindow,
} from "@agent-cost-analyzer/domain";
import type { DetectorResult } from "./savings-detector.js";

// Phase 16 SR10 (docs/plans/savings-report.md §5.2, D3, D4): the detectors'
// findings as one report. Pure: priced opportunities ordered by the high end
// of their window amount ("up to"), the low end breaking ties; an unknown
// amount last, never ranked as 0; cheaper-model savings (Simulated) in their
// own section, in the order the detector gave them. No grand total: the
// opportunities overlap.

export interface RankInput {
  window: SavingsWindow;
  pricing: PricingMode;
  results: readonly DetectorResult[];
  // Sessions no detector saw (over the session cap, unreadable), per kind.
  leftOut?: readonly SavingsNotAnalysed[];
}

const KIND_ORDER: readonly string[] = savingsOpportunityKindSchema.options;

// A known amount's end in USD, so AI Credits and dollars compare at the one
// documented rate; null when the amount is unknown.
function usd(amount: SavingsAmount, end: "low" | "high"): number | null {
  if (!amount.known) return null;
  return amount.currency === "USD" ? amount[end] : amount[end] * USD_PER_AI_CREDIT;
}

function byHighEnd(a: SavingsOpportunity, b: SavingsOpportunity): number {
  const [aHigh, bHigh] = [usd(a.perWindow, "high"), usd(b.perWindow, "high")];
  if (aHigh === null || bHigh === null) {
    if (aHigh !== bHigh) return aHigh === null ? 1 : -1;
    return a.key.localeCompare(b.key);
  }
  return bHigh - aHigh || usd(b.perWindow, "low")! - usd(a.perWindow, "low")! || a.key.localeCompare(b.key);
}

function byKindProviderReason(a: SavingsNotAnalysed, b: SavingsNotAnalysed): number {
  return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.providerId.localeCompare(b.providerId) || a.reason.localeCompare(b.reason);
}

export class SavingsRanker {
  rank(input: RankInput): SavingsReport {
    const all = input.results.flatMap((result) => result.opportunities);
    return {
      window: input.window,
      pricing: input.pricing,
      opportunities: all.filter((opportunity) => opportunity.kind !== "cheaper-model").sort(byHighEnd),
      simulated: all.filter((opportunity) => opportunity.kind === "cheaper-model"),
      notAnalysed: [...input.results.flatMap((result) => result.notAnalysed), ...(input.leftOut ?? [])].sort(byKindProviderReason),
    };
  }
}
