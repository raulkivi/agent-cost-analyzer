// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency, ReplayCoverage, ReplayPricing, ReplaySelfCheck, ReplaySubagentRuns, SimulatedCost } from "@agent-cost-analyzer/domain";
import { aiCreditsToUsd, formatUsd } from "./ai-credits-usd.js";

// Phase 14 step 14.7: the words and numbers the replay views share (mock-up
// boards 1, 2 and 4). An unknown is "unknown", never 0 (constraint 6).

export const UNKNOWN = "unknown";
const MINUS = "−";

export function currencyLabel(currency: Currency): string {
  return currency === "AI_CREDITS" ? "AI Credits" : "USD";
}

// AI Credits to 2 decimals, as everywhere; USD as the app's USD figures.
export function formatReplayAmount(value: number | null, currency: Currency): string {
  if (value === null) return UNKNOWN;
  return currency === "AI_CREDITS" ? value.toFixed(2) : formatUsd(value);
}

export function formatSimulatedCost(cost: SimulatedCost): string {
  return cost.known ? formatReplayAmount(cost.value, cost.currency) : UNKNOWN;
}

// The hover text of a simulated cost: its USD for AI Credits (1 AI Credit
// = $0.01, as the table's other credits), or why it's unknown.
export function replayCostTitle(cost: SimulatedCost): string | undefined {
  if (!cost.known) return `Unknown: ${cost.reason}`;
  return cost.currency === "AI_CREDITS" ? `≈ ${formatUsd(aiCreditsToUsd(cost.value))}` : undefined;
}

function signed(magnitude: string, value: number): string {
  if (value > 0) return `+${magnitude}`;
  if (value < 0) return `${MINUS}${magnitude}`;
  return magnitude;
}

// Simulated − measured, signed, with its share of the measured total.
export function formatReplayDifference(
  difference: number | null,
  measured: number | null,
  currency: Currency,
): { amount: string; percent: string | undefined } {
  if (difference === null) return { amount: UNKNOWN, percent: undefined };
  const amount = signed(formatReplayAmount(Math.abs(difference), currency), difference);
  if (measured === null || measured === 0) return { amount, percent: undefined };
  const share = (difference / measured) * 100;
  return { amount, percent: `${signed(Math.abs(share).toFixed(1), share)}%` };
}

// The runs the replay leaves out: it covers the main agent only. Nothing for
// none, or when the log recorded no run.
export function subagentRunsSentence(runs: ReplaySubagentRuns | undefined): string | undefined {
  if (runs === undefined || runs.runs === 0) return undefined;
  return `${runs.runs} subagent ${runs.runs === 1 ? "run" : "runs"} not replayed: replay covers the main agent only`;
}

// Their AI Credits, or why they are unknown (an unknown is never 0).
export function subagentRunsCostSentence(runs: ReplaySubagentRuns | undefined): string | undefined {
  if (runs === undefined || subagentRunsSentence(runs) === undefined) return undefined;
  const cost = runs.costAiCredits;
  return cost.known ? `Their cost is ${formatReplayAmount(cost.value, "AI_CREDITS")} AI Credits.` : `Their cost is ${UNKNOWN}: ${cost.reason}`;
}

export function coverageSentence(coverage: ReplayCoverage): string {
  const base = `${coverage.replayedTurns} of ${coverage.turns} turns replayed`;
  const missing = coverage.notReplayed.reduce((sum, group) => sum + group.turns, 0);
  let sentence = base;
  if (coverage.notReplayed.length === 1 && missing > 0) sentence = `${base}; ${missing} not replayed: ${coverage.notReplayed[0]!.reason}`;
  else if (coverage.notReplayed.length > 1 && missing > 0) sentence = `${base}; ${missing} not replayed, for ${coverage.notReplayed.length} reasons`;
  const subagents = subagentRunsSentence(coverage.subagentRuns);
  return subagents === undefined ? sentence : `${sentence}; ${subagents}`;
}

// G4: "Replay matches the log on <model>: N% of compared requests". A failed
// check never reads 100%, so rounding can't hide a disagreement.
export function selfCheckSentence(check: ReplaySelfCheck | null): string {
  if (check === null) {
    return "No self-check for this session: its own model can't be replayed against the log (it used more than one model the replay can hold, or its model has no vendor profile).";
  }
  const lead = `Replay matches the log on ${check.models.join(", then ")}`;
  if (check.requests === 0) return `${lead}: no request to compare (the first is a cold start)`;
  const rounded = Math.round((check.matching / check.requests) * 100);
  const percent = check.passed ? rounded : Math.min(rounded, 99);
  return `${lead}: ${percent}% of compared requests`;
}

export function selfCheckDetail(check: ReplaySelfCheck): string {
  const disagree = check.requests - check.matching;
  const counts = `${check.matching} of ${check.requests} compared requests match${disagree > 0 ? `; ${disagree} disagree` : ""}.`;
  return `${counts} The first request isn't compared (cold start).`;
}

export function selfCheckRule(check: ReplaySelfCheck): string {
  return `A request matches when its simulated cache read is within ${check.readTolerancePercent}% of the log's and its cache hit or miss is exactly the log's.`;
}

export function pricedAtSentence(pricing: ReplayPricing, vendorName: string): string {
  if (pricing.channel === null) return `Not priced: ${pricing.reason ?? "no price channel is known"}`;
  const where = pricing.channel === "copilot" ? "GitHub Copilot's" : `the ${vendorName} API's`;
  return `Priced at ${where} prices as of ${pricing.asOf}`;
}

// The service words each assumption "Title: text".
export function splitAssumption(text: string): { title: string | undefined; text: string } {
  const colon = text.indexOf(":");
  if (colon <= 0) return { title: undefined, text };
  return { title: text.slice(0, colon), text: text.slice(colon + 1).trim() };
}
