// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { OBSERVED_CHANGE_MIN_TURNS, OBSERVED_CHANGE_THRESHOLD, type InsightFinding, type ObservedPriceChange } from "@agent-cost-analyzer/domain";
import { PriceChangeDetector, type ObservedTurn } from "../pricing/price-change-detector.js";
import type { DetectorInput, FindingDetector } from "./finding-detector.js";

// Phase 15 step 15.10 (docs/plans/cost-by-repository-and-project.md §6.4
// point 2, D9, D11): each observed price change becomes an `inferred`
// finding of kind "price-change". A finding belongs to a session, so it is
// linked to the first session of the run's first week. With the dataset at
// today's prices the gap is the price change itself, so nothing is raised.

const fmt = (value: number) => String(Math.round(value * 100) / 100);

function evidenceOf(change: ObservedPriceChange): string {
  return change.weeks
    .map((week) => `${week.period}: ${week.turns} turns, billed ${fmt(week.billedAiCredits)} vs priced ${fmt(week.pricedAiCredits)} AI Credits (×${fmt(week.ratio)})`)
    .join("; ");
}

export class PriceChangeFindingDetector implements FindingDetector {
  constructor(private readonly detector = new PriceChangeDetector()) {}

  detect(input: DetectorInput): InsightFinding[] {
    if (input.pricing === "today") return [];
    const turns: ObservedTurn[] = input.rows.turns.flatMap((row) =>
      row.date !== undefined && row.cost !== undefined ? [{ date: row.date, model: row.model, channel: row.channel, sessionKey: row.sessionKey, cost: row.cost }] : [],
    );
    return this.detector.observed(turns).map((change) => {
      const first = change.weeks[0]!;
      const firstSession = turns
        .filter((turn) => turn.channel === change.channel && turn.model === change.modelId && turn.date >= first.start && turn.date <= first.end && turn.cost.billed.known && turn.cost.priced.known)
        .sort((a, b) => a.date.localeCompare(b.date) || a.sessionKey.localeCompare(b.sessionKey))[0]!;
      const size = Math.abs(change.percent);
      return {
        key: `price-change:${change.channel}:${change.modelId}:${change.date}`,
        sessionKey: firstSession.sessionKey,
        kind: "price-change",
        category: "observed-price-change",
        severity: "medium",
        ruleId: "pricing.observed-change",
        title: `Observed: ${change.modelId} billed ${fmt(size)}% ${change.direction} the price book since ${change.date}`,
        at: change.date,
        why:
          `Inferred, not documented: GitHub billed ${fmt(size)}% ${change.direction === "above" ? "more" : "less"} than the price book gives for the same ${change.channel} turns, ` +
          `${change.weeks.length} weeks in a row (more than ${OBSERVED_CHANGE_THRESHOLD * 100}% each week, with at least ${OBSERVED_CHANGE_MIN_TURNS} turns that have both figures). ` +
          "Check the price book for a change it doesn't have yet.",
        evidence: evidenceOf(change),
      };
    });
  }
}
