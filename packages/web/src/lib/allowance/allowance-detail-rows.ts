// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { MonthlyAllowanceAnswer } from "@agent-cost-analyzer/domain";
import { allowanceView } from "./allowance-view.js";

// MS7 (monthly-allowance-standalone.md §4.7): the details dialog's label and
// value rows, as drawn on Details.dc.html. The wording is the domain's
// `detailLines` (shared with the extension's tooltip); this only gives each
// line its label and adds the facts the dialog states beside them (warn at,
// reset day, source). Pure: no React.

export interface DetailRow {
  label: string;
  value: string;
}

export interface DetailRows {
  rows: DetailRow[];
  // Partial figures: drawn as a boxed note after the rows.
  higherNote: string | undefined;
}

interface Matcher {
  label: string;
  test: RegExp;
  // The part of the line that is the value; the whole line when absent.
  group?: boolean;
}

const MATCHERS: Matcher[] = [
  { label: "Allowance", test: /^Monthly allowance: (.+)$/, group: true },
  { label: "Used", test: /of the allowance used$/ },
  { label: "Remaining", test: /AI Credits remain$/ },
  { label: "Days left", test: /^\d+ days? left$/ },
  { label: "Period", test: /^Period (.+)$/, group: true },
  { label: "Coverage", test: /sessions this month have cost data$/ },
  { label: "Oldest counted", test: /^Oldest session counted: (.+)$/, group: true },
];

const HIGHER = /^The total may be higher/;

function rowOf(line: string): DetailRow | undefined {
  for (const { label, test, group } of MATCHERS) {
    const match = line.match(test);
    if (match) return { label, value: group ? (match[1] ?? line) : line };
  }
  return undefined;
}

function insertBefore(rows: DetailRow[], label: string, row: DetailRow): void {
  const at = rows.findIndex((candidate) => candidate.label === label);
  rows.splice(at < 0 ? rows.length : at, 0, row);
}

function sourceValue(answer: MonthlyAllowanceAnswer): string {
  return answer.source.available ? (answer.source.variant ?? "VS Code") : "VS Code: not available";
}

export function allowanceDetailRows(answer: MonthlyAllowanceAnswer): DetailRows {
  const view = allowanceView(answer);
  const hasFigure = view.meter !== undefined;
  const rows: DetailRow[] = [];
  let higherNote: string | undefined;
  for (const line of view.detailLines) {
    if (HIGHER.test(line)) {
      higherNote = line;
      continue;
    }
    const row = rowOf(line);
    // With a figure the lead line already says "of 1,000 AI Credits".
    if (row && !(row.label === "Allowance" && hasFigure)) rows.push(row);
  }
  if (hasFigure) insertBefore(rows, "Days left", { label: "Warn at", value: `${answer.settings.warnAtPercent} % of the allowance` });
  if (answer.settings.resetDay !== 1) insertBefore(rows, "Coverage", { label: "Reset day", value: String(answer.settings.resetDay) });
  if (answer.state === "no-sessions") rows.push({ label: "Coverage", value: "0 sessions this month" });
  rows.push({ label: "Source", value: sourceValue(answer) });
  return { rows, higherNote };
}
