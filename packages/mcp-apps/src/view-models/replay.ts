// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency, MeasuredCost, ReplayCoverage, ReplayPricing, ReplaySelfCheck, ReplayTotal, ReplayTurn, SessionReplay, SessionReplayComparison, SimulatedCost } from "@agent-cost-analyzer/domain";
import { UNKNOWN_TEXT, coverageNote, formatCount, pluralize } from "./format.js";
import { formatMoney, formatSignedMoney } from "./money.js";

// U12, a session replayed on another model (docs/plans/mcp-apps.md §2,
// §4.5). Pure: formats a replay_session or compare_models_for_session
// result. Every simulated figure carries "Simulated" (known or not); the
// measured figure stays apart; a null figure reads "Unknown", never 0; a
// failed or missing self-check is called out.

export const SIMULATED_LABEL = "Simulated";
export const MEASURED_LABEL = "Measured";

export interface ReplayFigure {
  text: string;
  amount: number | null; // null = unknown (a gap, never 0)
  known: boolean;
  label: typeof SIMULATED_LABEL | typeof MEASURED_LABEL;
  coverageNote?: string;
  unknownNote?: string;
}

export interface SelfCheckView {
  status: "passed" | "failed" | "missing";
  callout: boolean; // true unless passed
  text: string;
}

export interface ReplayCoverageView {
  text: string;
  partial: boolean;
  notReplayed: { reason: string; turnsText: string }[];
}

export interface ReplayTurnRow {
  turnIndex: number;
  replayed: boolean;
  outcomeText?: string;
  notReplayedReason?: string;
  measured: ReplayFigure;
  simulated: ReplayFigure;
}

export interface ReplayDetailViewModel {
  mode: "replay";
  label: typeof SIMULATED_LABEL;
  headline: string; // "would have cost about $0.48", or Unknown
  sessionId: string;
  providerId: string;
  model: string;
  measuredModelsText: string;
  pricingText: string;
  measured: ReplayFigure;
  simulated: ReplayFigure;
  difference: ReplayFigure;
  selfCheck: SelfCheckView;
  coverage: ReplayCoverageView;
  turns: ReplayTurnRow[];
  assumptions: { id: string; text: string; confidenceText: string }[];
}

export interface CompareEntryView {
  model: string; // the argument of the replay_session drill-down
  vendorId: string;
  isMeasuredModel: boolean;
  noteText?: string;
  total: ReplayFigure;
  replayedTurnsText: string;
}

export interface ReplayCompareViewModel {
  mode: "compare";
  label: typeof SIMULATED_LABEL;
  sessionId: string;
  providerId: string;
  measured: ReplayFigure;
  entries: CompareEntryView[];
}

export type ReplayViewModel = ReplayDetailViewModel | ReplayCompareViewModel;

const OUTCOME_TEXT: Record<string, string> = { hit: "cache hit", partial: "partial cache hit", miss: "cache miss", unknown: "cache outcome unknown" };

function figure(label: ReplayFigure["label"], value: number | null, currency: Currency, extra: { signed?: boolean; coverage?: string; note?: string } = {}): ReplayFigure {
  if (value === null) return { text: UNKNOWN_TEXT, amount: null, known: false, label, ...(extra.note === undefined ? {} : { unknownNote: extra.note }) };
  return {
    text: extra.signed ? formatSignedMoney(value, currency) : formatMoney(value, currency),
    amount: value,
    known: true,
    label,
    ...(extra.coverage === undefined ? {} : { coverageNote: extra.coverage }),
  };
}

function totalFigure(label: ReplayFigure["label"], total: ReplayTotal, currency: Currency): ReplayFigure {
  return figure(label, total.value, currency, { ...(coverageNote(total.knownTurns, total.turns) === undefined ? {} : { coverage: coverageNote(total.knownTurns, total.turns)! }) });
}

function costFigure(label: ReplayFigure["label"], cost: MeasuredCost | SimulatedCost, currency: Currency): ReplayFigure {
  return cost.known ? figure(label, cost.value, cost.currency) : figure(label, null, currency, { note: cost.reason });
}

function pricingText(pricing: ReplayPricing): string {
  if (pricing.channel === null) return `not priced: ${pricing.reason}`;
  const prices = pricing.channel === "copilot" ? "Copilot's AI Credit prices" : "the vendor's API prices";
  return `priced at ${prices} as of ${pricing.asOf}`;
}

function selfCheckView(check: ReplaySelfCheck | null): SelfCheckView {
  if (check === null) return { status: "missing", callout: true, text: "No self-check: the session's own model can't be replayed, so these figures are not checked against the log" };
  const counts = `${formatCount(check.matching)} of ${formatCount(check.requests)} requests match the log (cache read within ${check.readTolerancePercent} %)`;
  if (check.passed) return { status: "passed", callout: false, text: `Self-check passed: ${counts}` };
  return { status: "failed", callout: true, text: `Self-check failed: ${counts}; don't rely on the simulated figures` };
}

function coverageView(coverage: ReplayCoverage): ReplayCoverageView {
  return {
    text: `${formatCount(coverage.replayedTurns)} of ${formatCount(coverage.turns)} turns replayed`,
    partial: coverage.replayedTurns < coverage.turns,
    notReplayed: coverage.notReplayed.map((group) => ({ reason: group.reason, turnsText: pluralize(group.turns, "turn") })),
  };
}

function turnRow(turn: ReplayTurn, currency: Currency): ReplayTurnRow {
  const simulated = turn.simulated === null ? figure(SIMULATED_LABEL, null, currency, { note: turn.notReplayedReason }) : costFigure(SIMULATED_LABEL, turn.simulated.cost, currency);
  return {
    turnIndex: turn.turnIndex,
    replayed: turn.simulated !== null,
    ...(turn.simulated === null ? {} : { outcomeText: OUTCOME_TEXT[turn.simulated.outcome] }),
    ...(turn.notReplayedReason === undefined ? {} : { notReplayedReason: turn.notReplayedReason }),
    measured: costFigure(MEASURED_LABEL, turn.measured.cost, currency),
    simulated,
  };
}

function detailView(replay: SessionReplay): ReplayDetailViewModel {
  const { currency, totals } = replay;
  const simulated = totalFigure(SIMULATED_LABEL, totals.simulated, currency);
  return {
    mode: "replay",
    label: SIMULATED_LABEL,
    headline: simulated.known ? `would have cost about ${simulated.text}` : UNKNOWN_TEXT,
    sessionId: replay.sessionId,
    providerId: replay.providerId,
    model: replay.model,
    measuredModelsText: replay.measuredModels.join(", "),
    pricingText: pricingText(replay.pricing),
    measured: totalFigure(MEASURED_LABEL, totals.measured, currency),
    simulated,
    difference: figure(SIMULATED_LABEL, totals.difference, currency, { signed: true }),
    selfCheck: selfCheckView(replay.selfCheck),
    coverage: coverageView(replay.coverage),
    turns: replay.turns.map((turn) => turnRow(turn, currency)),
    assumptions: replay.assumptions.map((assumption) => ({ id: assumption.id, text: assumption.text, confidenceText: assumption.confidence })),
  };
}

function compareView(comparison: SessionReplayComparison): ReplayCompareViewModel {
  const { currency } = comparison;
  return {
    mode: "compare",
    label: SIMULATED_LABEL,
    sessionId: comparison.sessionId,
    providerId: comparison.providerId,
    measured: totalFigure(MEASURED_LABEL, comparison.measured, currency),
    entries: comparison.entries.map((entry): CompareEntryView => ({
      model: entry.model,
      vendorId: entry.vendorId,
      isMeasuredModel: entry.isMeasuredModel,
      ...(entry.isMeasuredModel ? { noteText: "the model the session used" } : {}),
      total: totalFigure(SIMULATED_LABEL, entry.total, currency),
      replayedTurnsText: `${formatCount(entry.replayedTurns)} of ${formatCount(entry.total.turns)} turns replayed`,
    })),
  };
}

export function toReplayViewModel(replay: SessionReplay | SessionReplayComparison): ReplayViewModel {
  return "entries" in replay ? compareView(replay) : detailView(replay);
}
