// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency, MeasuredCost, ReplayCoverage, ReplayPricing, ReplaySelfCheck, ReplayTotal, ReplayTurn, SessionReplay, SessionReplayComparison, SimulatedCost } from "@agent-cost-analyzer/domain";
import { MINUS, UNKNOWN_TEXT, coverageNote, formatCount, pluralize } from "./format.js";
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
  title: string; // the bold lead of the box: "Self-check failed."
  detail: string; // the rest of it, as the board words it (plan §9.2 Q2)
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
  currency: Currency;
  measuredBasisText?: string; // "billed", "priced", "reported" or "mixed bases"
  simulated: ReplayFigure;
  difference: ReplayFigure;
  differencePercentText?: string; // "−28.8 %" of the measured total, when both are known
  differenceNote?: string; // turns not replayed are in neither total
  selfCheck: SelfCheckView;
  coverage: ReplayCoverageView;
  turns: ReplayTurnRow[];
  assumptions: { id: string; text: string; confidenceText: string }[];
}

export interface CompareEntryView {
  model: string; // the argument of the replay_session drill-down
  vendorId: string;
  vendorText: string;
  isMeasuredModel: boolean;
  isMixedSessionModel: boolean;
  noteText?: string;
  total: ReplayFigure;
  displayText: string; // "≥ 132.75 AI Credits" for a floor, "Unknown" for none
  partial: boolean; // known for some turns only: a floor, no percent (Q3)
  changeText: string; // "−1.3 %", "partial" or "—"
  changeDirection: "decrease" | "increase" | "none";
  subText: string; // under the figure: what it is, its coverage or why it is Unknown
  replayedTurnsText: string;
}

export interface OwnModelCheckView {
  status: "shown" | "missing";
  callout: boolean; // true when the check can't be shown
  text: string;
}

export interface ReplayCompareViewModel {
  mode: "compare";
  label: typeof SIMULATED_LABEL;
  sessionId: string;
  providerId: string;
  turnsText: string;
  measured: ReplayFigure;
  measuredCoverageText: string; // "known for 42 of 42 turns", also when all are known
  measuredModel?: string; // the model the session used, from the entry flagged isMeasuredModel
  ownModelCheck: OwnModelCheckView; // plan §9.2 Q1: the compare result has no selfCheck
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

// One model by name; after a model switch, every model in the order the session used them.
const modelsText = (models: readonly string[]): string => models.join(", then ");

function selfCheckView(check: ReplaySelfCheck | null): SelfCheckView {
  if (check === null) {
    return {
      status: "missing",
      callout: true,
      text: "No self-check: the session's own model can't be replayed, so these figures are not checked against the log",
      title: "No self-check.",
      detail: "The session's own model can't be replayed, so these figures are not checked against the log. Treat them as rough, not as a quote.",
    };
  }
  const counts = `${formatCount(check.matching)} of ${formatCount(check.requests)} requests match the log (cache read within ${check.readTolerancePercent} %)`;
  const matched = `${formatCount(check.matching)} of ${formatCount(check.requests)} requests`;
  if (check.passed) return { status: "passed", callout: false, text: `Self-check passed: ${counts}`, title: "Self-check passed", detail: `on ${modelsText(check.models)}: ${matched} matched within ${check.readTolerancePercent} % cache read.` };
  return {
    status: "failed",
    callout: true,
    text: `Self-check failed: ${counts}; don't rely on the simulated figures`,
    title: "Self-check failed.",
    detail: `Replaying the session on its own model${check.models.length > 1 ? "s" : ""} (${modelsText(check.models)}) matched ${matched} within ${check.readTolerancePercent} % cache read, so the simulated figures below may be off. Treat them as rough, not as a quote.`,
  };
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

const VENDOR_TEXT: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };

// "−1.3 %" of the measured figure; nothing to say against an unknown or zero one.
function percentChange(value: number | null, measured: number | null): { text: string; direction: "decrease" | "increase" | "none" } | undefined {
  if (value === null || measured === null || measured <= 0) return undefined;
  const percent = ((value - measured) / measured) * 100;
  const text = Math.abs(percent).toFixed(1);
  if (Number(text) === 0) return { text: "0.0 %", direction: "none" };
  return percent < 0 ? { text: `${MINUS}${text} %`, direction: "decrease" } : { text: `+${text} %`, direction: "increase" };
}

function measuredBasisText(turns: ReplayTurn[]): string | undefined {
  const bases = new Set<string>();
  for (const turn of turns) if (turn.measured.cost.known) bases.add(turn.measured.cost.basis);
  if (bases.size === 0) return undefined;
  return bases.size === 1 ? [...bases][0] : "mixed bases";
}

// Turns not replayed are in neither (paired) total; what they measured is told when known.
function notReplayedNote(replay: SessionReplay): string | undefined {
  const missed = replay.turns.filter((turn) => turn.simulated === null);
  if (missed.length === 0) return undefined;
  const known = missed.flatMap((turn) => (turn.measured.cost.known ? [turn.measured.cost.value] : []));
  const measured = known.length === 0 ? "" : ` (${formatMoney(known.reduce((sum, value) => sum + value, 0), replay.currency)} measured)`;
  return `${pluralize(missed.length, "turn")} not replayed${measured} ${missed.length === 1 ? "is" : "are"} in neither total`;
}

function detailView(replay: SessionReplay): ReplayDetailViewModel {
  const { currency, totals } = replay;
  const simulated = totalFigure(SIMULATED_LABEL, totals.simulated, currency);
  const basis = measuredBasisText(replay.turns);
  const percent = percentChange(totals.simulated.value, totals.measured.value);
  const note = notReplayedNote(replay);
  return {
    mode: "replay",
    currency,
    label: SIMULATED_LABEL,
    headline: simulated.known ? `would have cost about ${simulated.text}` : UNKNOWN_TEXT,
    sessionId: replay.sessionId,
    providerId: replay.providerId,
    model: replay.model,
    measuredModelsText: replay.measuredModels.join(", "),
    pricingText: pricingText(replay.pricing),
    measured: totalFigure(MEASURED_LABEL, totals.measured, currency),
    ...(basis === undefined ? {} : { measuredBasisText: basis }),
    simulated,
    difference: figure(SIMULATED_LABEL, totals.difference, currency, { signed: true }),
    ...(totals.difference === null || percent === undefined ? {} : { differencePercentText: percent.text }),
    ...(note === undefined ? {} : { differenceNote: note }),
    selfCheck: selfCheckView(replay.selfCheck),
    coverage: coverageView(replay.coverage),
    turns: replay.turns.map((turn) => turnRow(turn, currency)),
    assumptions: replay.assumptions.map((assumption) => ({ id: assumption.id, text: assumption.text, confidenceText: assumption.confidence })),
  };
}

function entryView(entry: SessionReplayComparison["entries"][number], measured: ReplayTotal, currency: Currency): CompareEntryView {
  const total = totalFigure(SIMULATED_LABEL, entry.total, currency);
  const partial = total.known && entry.total.knownTurns < entry.total.turns;
  const change = partial ? undefined : percentChange(entry.total.value, measured.value);
  const replayed = `${formatCount(entry.replayedTurns)} of ${formatCount(entry.total.turns)}`;
  let subText = "would have cost about";
  if (!total.known) subText = entry.replayedTurns === 0 ? "no turn could be replayed on this model" : `replayed ${replayed} turns, none priced`;
  else if (partial) subText = total.coverageNote ?? subText;
  return {
    model: entry.model,
    vendorId: entry.vendorId,
    vendorText: VENDOR_TEXT[entry.vendorId] ?? entry.vendorId,
    isMeasuredModel: entry.isMeasuredModel,
    isMixedSessionModel: entry.isMixedSessionModel,
    ...(entry.isMeasuredModel ? { noteText: "the model the session used" } : {}),
    ...(entry.isMixedSessionModel ? { noteText: "the session's first model; it switched models" } : {}),
    total,
    displayText: partial ? `≥ ${total.text}` : total.text,
    partial,
    changeText: partial ? "partial" : (change?.text ?? "—"),
    changeDirection: change?.direction ?? "none",
    subText,
    replayedTurnsText: `${replayed} turns replayed`,
  };
}

// Plan §9.2 Q1: SessionReplayComparison has no selfCheck, so the own-model
// check is its simulated total against the measured one. A floor or an
// Unknown is no check, and is called out.
function ownModelCheck(entry: CompareEntryView | undefined, measured: ReplayFigure, measuredTotal: ReplayTotal, switchedModels?: string): OwnModelCheckView {
  const missing = (text: string): OwnModelCheckView => ({ status: "missing", callout: true, text: `No own-model check: ${text}, so these figures are not checked against the log.` });
  // The first model's whole-session replay is not a check against a log that used several.
  if (switchedModels !== undefined) return missing(`the session switched models (${switchedModels})`);
  if (entry === undefined) return missing("the session's own model is not among the replayed models");
  if (!entry.total.known) return missing(`the session's own model, ${entry.model}, came out ${UNKNOWN_TEXT} on replay`);
  if (entry.partial) return missing(`the session's own model, ${entry.model}, is known for ${entry.total.coverageNote?.replace("known for ", "") ?? "only some turns"} only`);
  const change = percentChange(entry.total.amount, measuredTotal.value);
  const against = measured.known ? ` against ${measured.text} measured${change === undefined ? "" : ` (${change.text})`}` : "";
  return { status: "shown", callout: false, text: `replayed on its own model, ${entry.model}, the session comes to ${entry.total.text}${against}. The request-by-request self-check is on each model's replay.` };
}

function compareView(comparison: SessionReplayComparison): ReplayCompareViewModel {
  const { currency } = comparison;
  const measured = totalFigure(MEASURED_LABEL, comparison.measured, currency);
  const entries = comparison.entries.map((entry) => entryView(entry, comparison.measured, currency));
  const mixed = comparison.measuredModels.length > 1;
  const own = entries.find((entry) => (mixed ? entry.isMixedSessionModel : entry.isMeasuredModel));
  const switchedModels = mixed ? comparison.measuredModels.join(", then ") : undefined;
  return {
    mode: "compare",
    label: SIMULATED_LABEL,
    sessionId: comparison.sessionId,
    providerId: comparison.providerId,
    turnsText: pluralize(comparison.measured.turns, "turn"),
    measured,
    measuredCoverageText: comparison.measured.knownTurns === 0 ? "no turn has a measured figure" : `known for ${formatCount(comparison.measured.knownTurns)} of ${formatCount(comparison.measured.turns)} turns`,
    ...(switchedModels !== undefined ? { measuredModel: switchedModels } : own === undefined ? {} : { measuredModel: own.model }),
    ownModelCheck: ownModelCheck(own, measured, comparison.measured, switchedModels),
    entries,
  };
}

export function toReplayViewModel(replay: SessionReplay | SessionReplayComparison): ReplayViewModel {
  return "entries" in replay ? compareView(replay) : detailView(replay);
}
