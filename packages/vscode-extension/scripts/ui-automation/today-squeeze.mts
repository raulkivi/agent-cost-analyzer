// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Fixtures date "today" sessions a fixed time before the run. A run less than that span after local
// midnight (CI at 00:07 UTC) would put them on yesterday, or last month on the 1st. These pure helpers
// squeeze the offsets into the time since local midnight, keeping their order; at any later hour the
// scale is 1 and the offsets are unchanged.

// Factor (0-1) to apply to offsets of up to `spanMs` before `now` so they stay on `now`'s local day.
export function todayScale(now: Date, spanMs: number): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const sinceMidnight = Math.max(now.getTime() - midnight.getTime() - 1_000, 0);
  return Math.min(1, sinceMidnight / spanMs);
}

// `agoMs` (at most `spanMs`) before `now`, squeezed onto `now`'s local day.
export function todayStartBefore(now: Date, agoMs: number, spanMs: number): Date {
  return new Date(now.getTime() - agoMs * todayScale(now, spanMs));
}
