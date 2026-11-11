// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostEstimate, EstimateUnit } from "@agent-cost-analyzer/domain";
import { pricingText } from "./analysis-common.js";
import { UNKNOWN_TEXT, formatCount, periodText, pluralize } from "./format.js";
import { formatMoney } from "./money.js";

// U15, the cost of planned work (docs/plans/mcp-apps.md §2, §4.5). Pure:
// formats an estimate_cost result. Always a p50–p90 range in USD labelled
// "estimate", never one number; a refusal shows its reason and every figure
// it can't give reads "Unknown", never 0. On another model the figures are
// simulated and say so.

export const ESTIMATE_LABEL = "estimate";

export interface EstimateSimulationView {
  label: "Simulated";
  model: string;
  vendorId: string;
  methodText: string;
  pricingText: string;
  sessionsText: string;
  turnsText: string;
  selfCheckText: string;
  notReplayed: { reason: string; turnsText: string }[];
  assumptions: { id: string; text: string; confidenceText: string }[];
}

export interface EstimateViewModel {
  label: typeof ESTIMATE_LABEL;
  targetName: string;
  refused: boolean;
  refusal?: string;
  rangeText: string; // "$95.00 – $210.00", or Unknown
  p50Text: string;
  p90Text: string;
  unitCostText: string;
  plannedText: string;
  windowText: string;
  pricingText: string;
  conversionNote: string;
  sample: { unitsText: string; turnsText: string; totalText: string; runRateText: string };
  simulation?: EstimateSimulationView;
}

const UNIT_NOUN: Record<EstimateUnit, string> = { activeDays: "active day", sessions: "session" };

const usd = (value: number) => formatMoney(value, "USD");
const range = (low: number, high: number) => `${usd(low)} – ${usd(high)}`;

function simulationView(simulation: NonNullable<CostEstimate["simulation"]>): EstimateSimulationView {
  const { selfCheck } = simulation;
  return {
    label: "Simulated",
    model: simulation.model,
    vendorId: simulation.vendorId,
    methodText: simulation.method,
    pricingText: "priced as each session was used",
    sessionsText: `${formatCount(simulation.replayedSessions)} of ${formatCount(simulation.sessions)} sessions replayed`,
    turnsText: `${formatCount(simulation.replayedTurns)} of ${formatCount(simulation.turns)} turns replayed`,
    selfCheckText:
      selfCheck.checked === 0
        ? "no self-check ran"
        : `self-check passed for ${formatCount(selfCheck.passed)} of ${formatCount(selfCheck.checked)} replayed sessions checked`,
    notReplayed: simulation.notReplayed.map((group) => ({ reason: group.reason, turnsText: pluralize(group.turns, "turn") })),
    assumptions: simulation.assumptions.map((assumption) => ({ id: assumption.id, text: assumption.text, confidenceText: assumption.confidence })),
  };
}

export function toEstimateViewModel(estimate: CostEstimate): EstimateViewModel {
  const noun = UNIT_NOUN[estimate.unit];
  const window = periodText(estimate.window.since, estimate.window.until);
  const perDay = estimate.runRate.perActiveDayUsd === null ? UNKNOWN_TEXT : usd(estimate.runRate.perActiveDayUsd);
  return {
    label: ESTIMATE_LABEL,
    targetName: estimate.target.name,
    refused: estimate.range === null,
    ...(estimate.refusal === undefined ? {} : { refusal: estimate.refusal }),
    rangeText: estimate.range === null ? UNKNOWN_TEXT : range(estimate.range.p50, estimate.range.p90),
    p50Text: estimate.range === null ? UNKNOWN_TEXT : usd(estimate.range.p50),
    p90Text: estimate.range === null ? UNKNOWN_TEXT : usd(estimate.range.p90),
    unitCostText: estimate.unitCost === null ? UNKNOWN_TEXT : `${range(estimate.unitCost.p50, estimate.unitCost.p90)} per ${noun}`,
    plannedText: pluralize(estimate.planned, noun),
    windowText: `last ${estimate.window.weeks} weeks (${window})`,
    pricingText: pricingText(estimate.pricing),
    conversionNote: estimate.conversion,
    sample: {
      unitsText: `${pluralize(estimate.history.units, noun)} seen, ${formatCount(estimate.history.knownUnits)} with every turn priced`,
      turnsText: pluralize(estimate.history.turns, "turn"),
      totalText: usd(estimate.history.totalUsd),
      runRateText: `${perDay} per active day, ${usd(estimate.runRate.perWeekUsd)} per week`,
    },
    ...(estimate.simulation === undefined ? {} : { simulation: simulationView(estimate.simulation) }),
  };
}
