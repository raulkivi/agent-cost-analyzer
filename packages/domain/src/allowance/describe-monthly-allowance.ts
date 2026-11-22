// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { AllowanceLevel, MonthlyAllowanceFigures, MonthlyAllowanceResult } from "./monthly-allowance.js";
import { identityTranslate, type Translate } from "./translate.js";

// The shared wording of the monthly allowance (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/monthly-allowance-standalone.md
// §4.1, §4.7): the extension's status bar and the app's header and dialogs say
// the same thing because both take it from here. Pure text, no codicons and no
// product phrases ("Open Sessions."). Whole messages per state, so a translator
// never assembles "at least" from fragments; numbers are not translated.

export type AllowanceWordingState = "known" | "unknown" | "no-sessions" | "no-source";

export interface AllowanceDescription {
  state: AllowanceWordingState;
  level: AllowanceLevel;
  // Figure first, level last, so truncation keeps the figure (owner decision
  // 1, 2026-11-13). No percentage: it lives in the details and the aria label.
  statusLine: string;
  // The statusLine without the level word, for a layout that shows the word
  // apart (the narrow header, next to the meter).
  figure: string;
  // "near limit" or "over"; absent when normal.
  levelWord: string | undefined;
  // "near" or "over" for narrow widths (owner decision 2026-11-15); the full
  // word stays in the details and the aria label.
  shortLevelWord: string | undefined;
  // The level sentence first when near or over; no product phrase at the end.
  ariaLabel: string;
  // "12 days left" or "1 day left", for a row or a header that shows it apart.
  daysLeft: string;
  // The tooltip or dialog lines in reading order. Never a figure when unknown.
  detailLines: string[];
  // The sentence explaining unknown, no sessions or no source; absent when known.
  note: string | undefined;
}

export type MonthlyAllowanceDescription = { state: "hidden" } | AllowanceDescription;

export interface DescribeOptions {
  t?: Translate;
  // false: the Copilot logs are missing, so the state is no-source whatever the
  // figures say. Omitted means the source is there.
  sourceAvailable?: boolean;
  // With the zone the period line reads "Period 2026-11-01 to 2026-11-30 (zone)";
  // without it "Period started 2026-11-01".
  timeZone?: string;
}

// English digit grouping, as the numbers are not translated (no bundle yet).
const CENTS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ALLOWANCE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function stateOf(figures: MonthlyAllowanceFigures, sourceAvailable: boolean): AllowanceWordingState {
  if (!sourceAvailable) {
    return "no-source";
  }
  if (figures.coverage.total === 0) {
    return "no-sessions";
  }
  return figures.used === null || figures.percent === null ? "unknown" : "known";
}

function knownFigure(level: AllowanceLevel, atLeast: boolean, used: string, allowance: string, t: Translate): string {
  if (level === "over") {
    return atLeast ? t("at least {0} of {1} AI Credits · over", used, allowance) : t("{0} of {1} AI Credits · over", used, allowance);
  }
  if (level === "near") {
    return atLeast ? t("at least {0} of {1} AI Credits · near limit", used, allowance) : t("{0} of {1} AI Credits · near limit", used, allowance);
  }
  return knownFigurePlain(atLeast, used, allowance, t);
}

function knownFigurePlain(atLeast: boolean, used: string, allowance: string, t: Translate): string {
  return atLeast ? t("at least {0} of {1} AI Credits", used, allowance) : t("{0} of {1} AI Credits", used, allowance);
}

function levelSentence(level: AllowanceLevel, t: Translate): string {
  if (level === "over") {
    return `${t("Over the allowance.")} `;
  }
  return level === "near" ? `${t("Near limit.")} ` : "";
}

function coverageText(known: number, total: number, t: Translate): string {
  return total === 1 ? t("{0} of {1} session this month has cost data", known, total) : t("{0} of {1} sessions this month have cost data", known, total);
}

function daysLeftText(daysLeft: number, t: Translate): string {
  return daysLeft === 1 ? t("1 day left") : t("{0} days left", daysLeft);
}

// The last day of the period, as a day key, from the exclusive end.
function lastDayKey(endKeyExclusive: string): string {
  const [year, month, day] = endKeyExclusive.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

function periodLine(figures: MonthlyAllowanceFigures, timeZone: string | undefined, t: Translate): string {
  const { startKey, endKeyExclusive } = figures.period;
  return timeZone === undefined ? t("Period started {0}", startKey) : t("Period {0} to {1} ({2})", startKey, lastDayKey(endKeyExclusive), timeZone);
}

export function describeMonthlyAllowance(result: MonthlyAllowanceResult, options: DescribeOptions = {}): MonthlyAllowanceDescription {
  if (result.level === "hidden") {
    return { state: "hidden" };
  }
  const { t = identityTranslate, sourceAvailable = true, timeZone } = options;
  const figures = result;
  const { level, allowance, used, atLeast, percent, remaining, countedSinceKey, coverage: counts } = figures;
  const state = stateOf(figures, sourceAvailable);
  const allowanceText = ALLOWANCE.format(allowance);
  const days = daysLeftText(figures.daysLeft, t);
  const coverage = coverageText(counts.known, counts.total, t);
  const usedText = used === null ? "" : CENTS.format(used);

  let statusLine: string;
  let figure: string;
  let ariaMain: string;
  let note: string | undefined;
  if (state === "no-source") {
    statusLine = t("AI Credits this month: no Copilot logs");
    figure = statusLine;
    note = t("No Copilot Chat logs found on this machine.");
    ariaMain = `${t("AI Credits this month: no Copilot logs, {0} AI Credits allowance, {1}.", allowanceText, days)} ${note}`;
  } else if (state === "no-sessions") {
    statusLine = t("No sessions this month");
    figure = statusLine;
    note = t("No Copilot session started in this period on this machine.");
    ariaMain = t("No sessions this month, {0} AI Credits allowance, {1}.", allowanceText, days);
  } else if (state === "unknown") {
    statusLine = t("AI Credits this month: unknown");
    figure = statusLine;
    note = t("No session this month has cost data, so no total is shown. Unknown is not 0.");
    ariaMain = t("AI Credits this month: unknown, {0} allowance, {1}, {2}.", allowanceText, days, coverage);
  } else {
    statusLine = knownFigure(level, atLeast, usedText, allowanceText, t);
    figure = knownFigurePlain(atLeast, usedText, allowanceText, t);
    ariaMain = atLeast
      ? t("AI Credits this month: at least {0} of {1} allowance, {2} percent, {3}, {4}.", usedText, allowanceText, percent as number, days, coverage)
      : t("AI Credits this month: {0} of {1} allowance, {2} percent, {3}, {4}.", usedText, allowanceText, percent as number, days, coverage);
  }

  // A level word only on a known figure: the other states have no used figure to
  // be near or over.
  const shownLevel = state === "known" ? level : "normal";
  const detailLines = [
    t("Monthly allowance: {0} AI Credits", allowanceText),
    percent === null ? undefined : atLeast ? t("At least {0} % of the allowance used", percent) : t("{0} % of the allowance used", percent),
    remaining === null ? undefined : remaining > 0 ? t("Up to {0} AI Credits remain", CENTS.format(remaining)) : t("No AI Credits remain"),
    days,
    periodLine(figures, timeZone, t),
    counts.total === 0 ? undefined : coverage,
    countedSinceKey === undefined ? undefined : t("Oldest session counted: {0}", countedSinceKey),
    atLeast ? t("The total may be higher: sessions without cost data are not counted.") : undefined,
    t("Only sessions recorded on this machine are counted."),
  ].filter((line): line is string => line !== undefined);

  return {
    state,
    level: shownLevel,
    statusLine,
    figure,
    levelWord: shownLevel === "over" ? t("over") : shownLevel === "near" ? t("near limit") : undefined,
    shortLevelWord: shownLevel === "over" ? t("over") : shownLevel === "near" ? t("near") : undefined,
    ariaLabel: `${state === "known" ? levelSentence(level, t) : ""}${ariaMain}`,
    daysLeft: days,
    detailLines,
    note,
  };
}
