// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SavingsWindow } from "@agent-cost-analyzer/domain";

// Phase 16 SR10 (docs/plans/savings-report.md D8): the report's window, both
// ends inclusive UTC calendar dates, compared with each session's start as
// the other rollups do. 30 days to today unless asked otherwise.

export const DEFAULT_SAVINGS_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// A validation error, as the route's 400 will be (SR12 checks its query first).
export class InvalidSavingsWindowError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSavingsWindowError";
  }
}

function dayOf(date: string, field: "since" | "until"): number {
  const time = DATE.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== date) {
    throw new InvalidSavingsWindowError(`${field} must be a calendar date (YYYY-MM-DD)`);
  }
  return time / DAY_MS;
}

const dateOf = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

export function savingsWindowOf(range: { since?: string; until?: string }, now: Date): SavingsWindow {
  const today = Math.floor(now.getTime() / DAY_MS);
  const until = range.until !== undefined ? dayOf(range.until, "until") : today;
  const since = range.since !== undefined ? dayOf(range.since, "since") : until - (DEFAULT_SAVINGS_WINDOW_DAYS - 1);
  if (since > until) throw new InvalidSavingsWindowError("since cannot be after until");
  return { since: dateOf(since), until: dateOf(until), days: until - since + 1 };
}
