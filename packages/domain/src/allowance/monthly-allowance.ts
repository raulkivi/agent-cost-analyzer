// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Session } from "../session.js";
import type { AllowanceSettings } from "./allowance-settings.js";
import { periodOf } from "./billing-period.js";
import { dayKeyOf, dayStartInstant } from "./day-key.js";
import { billedCredits, knownSum } from "./session-credits.js";

// The monthly AI Credits allowance figures (step 10.21, plan
// https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/monthly-allowance.md §3.2 to §3.4; MA13, https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/monthly-allowance-standalone.md
// §4.1). Figures only: each product words them. No projection or run rate
// (D3): used, remaining ("up to") and days left only.

export const ALLOWANCE_LEVELS = ["normal", "near", "over"] as const;
export type AllowanceLevel = (typeof ALLOWANCE_LEVELS)[number];

export interface HiddenAllowance {
  level: "hidden";
}

export interface MonthlyAllowanceFigures {
  // Words must carry the level; a color may only add to them.
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
}

export type MonthlyAllowanceResult = HiddenAllowance | MonthlyAllowanceFigures;

export interface MonthlyAllowanceInput {
  sessions: Session[];
  now: Date;
  timeZone?: string;
  settings: AllowanceSettings;
}

// Keeps float error (0.1 + 0.2) from deciding a level or a percentage.
const EPSILON = 1e-9;

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

export function computeMonthlyAllowance({ sessions, now, timeZone, settings }: MonthlyAllowanceInput): MonthlyAllowanceResult {
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
  const percentExact = used === null ? 0 : (used * 100) / allowance + EPSILON;
  return {
    level: levelOf(percentExact, settings.warnAtPercent),
    allowance,
    used,
    atLeast: used !== null && sum.known < total,
    percent: used === null ? null : Math.floor(percentExact),
    remaining: used === null ? null : Math.max(0, roundToCents(allowance - used)),
    daysLeft: period.daysLeft,
    period: { startKey: period.startKey, endKeyExclusive: period.endKeyExclusive },
    coverage: { known: sum.known, total },
    countedSinceKey: total === 0 ? undefined : dayKeyOf(new Date(oldest), timeZone),
  };
}
