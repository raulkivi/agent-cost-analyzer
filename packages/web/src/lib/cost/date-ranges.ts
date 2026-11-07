// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { addDays, comparisonPeriod, type Bucket, type CostBucket } from "@agent-cost-analyzer/domain";

// Phase 15 step 15.9 (plan §11.2): the cost tabs' date range presets, in
// UTC calendar dates like every other Dashboard figure (D6). Ranges are
// inclusive.

export type RangePreset = "this-month" | "last-month" | "last-90-days" | "this-year";

export interface DateRange {
  since: string;
  until: string;
}

export const RANGE_PRESETS: readonly { value: RangePreset; label: string }[] = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "last-90-days", label: "Last 90 days" },
  { value: "this-year", label: "This year" },
];

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export function rangeFor(preset: RangePreset, now: Date): DateRange {
  const today = isoDate(now);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  switch (preset) {
    case "this-month":
      return { since: `${today.slice(0, 7)}-01`, until: today };
    case "last-month":
      return {
        since: isoDate(new Date(Date.UTC(year, month - 1, 1))),
        until: isoDate(new Date(Date.UTC(year, month, 0))),
      };
    case "last-90-days":
      return { since: addDays(today, -89), until: today };
    case "this-year":
      return { since: `${year}-01-01`, until: today };
  }
}

export function previousRange(range: DateRange): DateRange {
  return comparisonPeriod(range.since, range.until, "previous");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parts(date: string): { year: string; month: number; day: number } {
  return { year: date.slice(0, 4), month: Number(date.slice(5, 7)) - 1, day: Number(date.slice(8, 10)) };
}

export function shortDate(date: string): string {
  const { month, day } = parts(date);
  return `${MONTHS[month]} ${day}`;
}

export function longDate(date: string): string {
  const { year, month, day } = parts(date);
  return `${MONTHS[month]} ${day}, ${year}`;
}

export function bucketAxisLabel(bucket: Bucket, kind: CostBucket): string {
  if (kind === "month") {
    const { year, month } = parts(bucket.start);
    return `${MONTHS[month]} ${year}`;
  }
  return shortDate(bucket.start);
}

export function bucketLongLabel(bucket: Bucket, kind: CostBucket): string {
  if (kind === "week") return `Week of ${longDate(bucket.start)}`;
  if (kind === "month") {
    const { year, month } = parts(bucket.start);
    return `${LONG_MONTHS[month]} ${year}`;
  }
  return longDate(bucket.start);
}

// The indexed chart's bucket: enough points to show a shape, not hundreds.
export function compareBucketFor(range: DateRange): CostBucket {
  const days = Math.round((Date.parse(range.until) - Date.parse(range.since)) / 86_400_000) + 1;
  if (days <= 31) return "day";
  return days <= 184 ? "week" : "month";
}
