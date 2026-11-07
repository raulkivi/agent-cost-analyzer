// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();

  if (diffMs < MINUTE) return "just now";
  if (diffMs < HOUR) return pluralize(Math.floor(diffMs / MINUTE), "minute");
  if (diffMs < DAY) return pluralize(Math.floor(diffMs / HOUR), "hour");
  if (diffMs < MONTH) return pluralize(Math.floor(diffMs / DAY), "day");
  if (diffMs < YEAR) return pluralize(Math.floor(diffMs / MONTH), "month");
  return pluralize(Math.floor(diffMs / YEAR), "year");
}
