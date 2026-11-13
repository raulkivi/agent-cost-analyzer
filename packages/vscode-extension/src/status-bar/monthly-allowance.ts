// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Session } from "@agent-cost-analyzer/domain";
import { identityTranslate, type Translate } from "../l10n/localize.js";
import type { AllowanceSettings } from "../settings/allowance-settings.js";
import { periodOf } from "../time/billing-period.js";
import { dayKeyOf, dayStartInstant } from "../time/local-time.js";
import { billedCredits, knownSum } from "./session-credits.js";

// The monthly AI Credits allowance gauge (step 10.21, plan
// monthly-allowance.md §3.2 to §3.4). Pure and free of `vscode`: the status
// bar adapter and the Sessions view apply it. No projection or run rate (D3):
// used, remaining ("up to") and days left only.

export type AllowanceLevel = "normal" | "near" | "over";

export interface HiddenAllowance {
  level: "hidden";
}

export interface MonthlyAllowance {
  // The words in `text` and `ariaLabel` carry the level; a background colour
  // may only add to them.
  level: AllowanceLevel;
  allowance: number;
  // Billed AI Credits of the period's known sessions, rounded to cents;
  // null when none of them has cost data (unknown is never 0).
  used: number | null;
  // Some sessions have no cost data, so `used` is a lower bound.
  atLeast: boolean;
  // Whole percent, rounded down so it never reads above the level; null
  // with `used`.
  percent: number | null;
  // An upper bound ("up to"), never below 0; null with `used`.
  remaining: number | null;
  daysLeft: number;
  period: { startKey: string; endKeyExclusive: string };
  coverage: { known: number; total: number };
  // The day of the oldest session counted (pruned logs make the sum low).
  countedSinceKey: string | undefined;
  // Status bar text, codicon first and outside the translated message.
  text: string;
  tooltip: string;
  ariaLabel: string;
  // The Sessions view header row: the state as the label, the days left as
  // the muted description.
  rowLabel: string;
  rowDescription: string;
}

export type MonthlyAllowanceView = HiddenAllowance | MonthlyAllowance;

export interface MonthlyAllowanceInput {
  sessions: Session[];
  now: Date;
  timeZone?: string;
  settings: AllowanceSettings;
  t?: Translate;
}

const CODICONS: Record<AllowanceLevel, string> = { normal: "$(dashboard)", near: "$(warning)", over: "$(error)" };

// Keeps float error (0.1 + 0.2) from deciding a level or a percentage.
const EPSILON = 1e-9;

// English digit grouping, as the numbers are not translated (no bundle yet).
const CENTS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ALLOWANCE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const roundToCents = (value: number) => Math.round(value * 100) / 100;

function usableAllowance(aiCredits: number | null): number | undefined {
  return aiCredits !== null && Number.isFinite(aiCredits) && aiCredits > 0 ? aiCredits : undefined;
}

function levelOf(percentExact: number, warnAtPercent: number): AllowanceLevel {
  if (percentExact >= 100) {
    return "over";
  }
  return percentExact >= warnAtPercent ? "near" : "normal";
}

// Whole messages per level and bound, so a translator never assembles
// "at least" from fragments. The figure comes first and the level word last,
// so truncation keeps the figure (owner decision 1, 2026-11-13); the
// percentage lives in the tooltip and the aria label only (decision 3).
function knownFigure(level: AllowanceLevel, atLeast: boolean, used: string, allowance: string, t: Translate): string {
  if (level === "over") {
    return atLeast ? t("at least {0} of {1} AI Credits · over", used, allowance) : t("{0} of {1} AI Credits · over", used, allowance);
  }
  if (level === "near") {
    return atLeast ? t("at least {0} of {1} AI Credits · near limit", used, allowance) : t("{0} of {1} AI Credits · near limit", used, allowance);
  }
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

export function buildMonthlyAllowance({ sessions, now, timeZone, settings, t = identityTranslate }: MonthlyAllowanceInput): MonthlyAllowanceView {
  const allowance = usableAllowance(settings.aiCredits);
  if (allowance === undefined) {
    return { level: "hidden" };
  }
  const period = periodOf(now, timeZone, settings.resetDay);
  // A session without a readable start cannot be placed in a period, so it
  // is left out. A session is attributed wholly to the day it started (§3.5).
  // The period's two boundary instants are computed once, so each session costs
  // one Date.parse instead of one Intl.DateTimeFormat (§3.6).
  const from = dayStartInstant(period.startKey, timeZone);
  const until = dayStartInstant(period.endKeyExclusive, timeZone);
  const inPeriod: Session[] = [];
  let oldest = Number.POSITIVE_INFINITY;
  for (const session of sessions) {
    const started = session.startedAt === undefined ? Number.NaN : Date.parse(session.startedAt);
    if (started >= from && started < until) {
      inPeriod.push(session);
      oldest = Math.min(oldest, started);
    }
  }
  // D7 (v1): whole-session known or unknown. An `estimated` value is a local
  // guess, not billed, so it counts as unknown and the sum stays billed
  // credits only, a lower bound read against the bill ("at least").
  const sum = knownSum(inPeriod, billedCredits);
  const total = inPeriod.length;
  const used = sum.known === 0 ? null : roundToCents(sum.total);
  const atLeast = used !== null && sum.known < total;
  const percentExact = used === null ? 0 : (used * 100) / allowance + EPSILON;
  const level = levelOf(percentExact, settings.warnAtPercent);
  const percent = used === null ? null : Math.floor(percentExact);
  const remaining = used === null ? null : Math.max(0, roundToCents(allowance - used));

  const allowanceText = ALLOWANCE.format(allowance);
  const days = daysLeftText(period.daysLeft, t);
  const coverage = coverageText(sum.known, total, t);
  const usedText = used === null ? "" : CENTS.format(used);

  let figure: string;
  let rowLabel: string;
  let ariaMain: string;
  if (total === 0) {
    figure = t("No sessions this month");
    rowLabel = t("This month: no sessions");
    ariaMain = t("No sessions this month, {0} AI Credits allowance, {1}. Open Sessions.", allowanceText, days);
  } else if (used === null || percent === null) {
    figure = t("AI Credits this month: unknown");
    rowLabel = t("This month: AI Credits unknown");
    ariaMain = t("AI Credits this month: unknown, {0} allowance, {1}, {2}. Open Sessions.", allowanceText, days, coverage);
  } else {
    figure = knownFigure(level, atLeast, usedText, allowanceText, t);
    rowLabel = t("This month: {0}", figure);
    ariaMain = atLeast
      ? t("AI Credits this month: at least {0} of {1} allowance, {2} percent, {3}, {4}. Open Sessions.", usedText, allowanceText, percent, days, coverage)
      : t("AI Credits this month: {0} of {1} allowance, {2} percent, {3}, {4}. Open Sessions.", usedText, allowanceText, percent, days, coverage);
  }

  const countedSinceKey = inPeriod.length === 0 ? undefined : dayKeyOf(new Date(oldest), timeZone);
  const tooltip = [
    t("Monthly allowance: {0} AI Credits", allowanceText),
    percent === null ? undefined : atLeast ? t("At least {0} % of the allowance used", percent) : t("{0} % of the allowance used", percent),
    remaining === null ? undefined : remaining > 0 ? t("Up to {0} AI Credits remain", CENTS.format(remaining)) : t("No AI Credits remain"),
    days,
    t("Period started {0}", period.startKey),
    total === 0 ? undefined : coverage,
    countedSinceKey === undefined ? undefined : t("Oldest session counted: {0}", countedSinceKey),
    atLeast ? t("The total may be higher: sessions without cost data are not counted.") : undefined,
    t("Only sessions recorded on this machine are counted."),
  ].filter((line): line is string => line !== undefined);

  return {
    level,
    allowance,
    used,
    atLeast,
    percent,
    remaining,
    daysLeft: period.daysLeft,
    period: { startKey: period.startKey, endKeyExclusive: period.endKeyExclusive },
    coverage: { known: sum.known, total },
    countedSinceKey,
    // The codicon stays outside the message: a translator must not see it.
    text: `${CODICONS[level]} ${figure}`,
    tooltip: tooltip.join("\n"),
    ariaLabel: `${levelSentence(level, t)}${ariaMain}`,
    rowLabel,
    rowDescription: t("· {0}", days),
  };
}
