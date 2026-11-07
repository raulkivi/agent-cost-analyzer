// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { MeasureTotal } from "@agent-cost-analyzer/domain";

// Display formatting shared by the view models (docs/plans/mcp-apps.md
// §4.3). Pure. An unknown value is null in the data and reads "Unknown"
// here, never 0 (architecture.md constraint 6).

export const UNKNOWN_TEXT = "Unknown";

// A figure ready to display: its text, whether it is known, the "estimate"
// tag, and the partial-coverage note. Unknown figures never carry the tag.
export interface MeasureView {
  text: string;
  known: boolean;
  estimate: boolean;
  coverageNote?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function trimmed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "");
}

// 950 -> "950", 4200 -> "4.2 k", 310412 -> "310 k", 2100000 -> "2.1 M".
export function formatTokens(value: number): string {
  if (value < 1000) return String(Math.round(value));
  const thousands = value / 1000;
  const kText = trimmed(thousands, thousands < 100 ? 1 : 0);
  if (Number(kText) < 1000) return `${kText} k`;
  return `${trimmed(value / 1_000_000, 1)} M`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function pluralize(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;
}

// "Oct 27", in UTC so the text doesn't depend on the viewer's time zone.
export function formatDay(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

// Partial coverage only: some turns known, some not. All known needs no
// note, and none known reads "Unknown" on its own.
export function coverageNote(knownTurns: number, turns: number): string | undefined {
  if (knownTurns <= 0 || knownTurns >= turns) return undefined;
  return `known for ${formatCount(knownTurns)} of ${formatCount(turns)} turns`;
}

export function valueView(value: number | null, format: (value: number) => string): MeasureView {
  if (value === null || !Number.isFinite(value)) return { text: UNKNOWN_TEXT, known: false, estimate: false };
  return { text: format(value), known: true, estimate: false };
}

export function measureView(total: MeasureTotal, format: (value: number) => string): MeasureView {
  const view = valueView(total.value, format);
  if (!view.known) return view;
  const note = coverageNote(total.knownTurns, total.turns);
  return { ...view, estimate: total.estimated, ...(note === undefined ? {} : { coverageNote: note }) };
}
