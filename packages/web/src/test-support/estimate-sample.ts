// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostEstimate } from "@agent-cost-analyzer/domain";

// Phase 15 step 15.12: a sample cost estimate for the web tests and the
// extension's UI check (placeholder data only).
export function sampleEstimate(overrides: Partial<CostEstimate> = {}): CostEstimate {
  return {
    label: "estimate",
    generatedAt: "2026-11-06T12:00:00.000Z",
    target: { groupBy: "project", id: "portal", name: "Customer portal" },
    pricing: "today",
    currency: "USD",
    conversion: "Every amount is in USD at today's prices: AI Credits converted at 1 AI Credit = $0.01.",
    window: { weeks: 12, since: "2026-08-15", until: "2026-11-06" },
    unit: "activeDays",
    planned: 20,
    history: { units: 7, knownUnits: 6, turns: 30, totalUsd: 62.4 },
    runRate: { perActiveDayUsd: 10.4, perWeekUsd: 5.2 },
    unitCost: { p50: 10.4, p90: 13.7 },
    range: { p50: 208, p90: 274 },
    ...overrides,
  };
}
