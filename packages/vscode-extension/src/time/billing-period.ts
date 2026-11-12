// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { dayKeyOf } from "./local-time.js";

// The billing period containing an instant: a month that starts on the user's
// reset day (1 to 28, so every month has it) in the user's local time zone.
export interface BillingPeriod {
  startKey: string; // first day, "YYYY-MM-DD"
  endKeyExclusive: string; // first day of the next period
  daysLeft: number; // inclusive of today: 1 on the last day
  dayOfPeriod: number; // 1 on the first day
}

const MS_PER_DAY = 86_400_000;

function parse(dayKey: string): [number, number, number] {
  return dayKey.split("-").map(Number) as [number, number, number];
}

function keyOf(year: number, monthIndex: number, day: number): string {
  // Date.UTC normalises a month index outside 0..11 into the neighbouring year.
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

// Whole days between two day keys by calendar arithmetic (UTC dates, so
// daylight-saving shifts of the local zone cannot add or drop a day).
function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = parse(fromKey);
  const [ty, tm, td] = parse(toKey);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY);
}

export function periodOf(now: Date, timeZone: string | undefined, resetDay: number): BillingPeriod {
  const todayKey = dayKeyOf(now, timeZone);
  const [year, month, day] = parse(todayKey);
  const startMonthIndex = day >= resetDay ? month - 1 : month - 2;
  const startKey = keyOf(year, startMonthIndex, resetDay);
  const endKeyExclusive = keyOf(year, startMonthIndex + 1, resetDay);
  return {
    startKey,
    endKeyExclusive,
    daysLeft: daysBetween(todayKey, endKeyExclusive),
    dayOfPeriod: daysBetween(startKey, todayKey) + 1,
  };
}
