// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Calendar days in the user's time zone. Every function takes the IANA zone
// to judge the day in; omitted, it is the machine's own, which is what the
// user sees.

// "YYYY-MM-DD" of the instant in the time zone: sorts chronologically as text.
export function dayKeyOf(instant: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const { year, month, day } = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${year}-${month}-${day}`;
}

// The first instant (ms since the epoch) of a local day: computed once per
// boundary so a session's start can be compared as a number instead of being
// formatted into a day key. Binary search on the monotone day key over a
// window wider than any zone offset, so DST and odd offsets need no rules.
export function dayStartInstant(dayKey: string, timeZone?: string): number {
  const [year, month, day] = dayKey.split("-").map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(year, month - 1, day);
  const HOUR = 3_600_000;
  let low = utcMidnight - 15 * HOUR; // before the day starts in any zone
  let high = utcMidnight + 15 * HOUR; // on the day or after it in any zone
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dayKeyOf(new Date(middle), timeZone) >= dayKey) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}
