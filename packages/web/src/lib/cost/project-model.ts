import type { VarianceCurrency } from "@agent-cost-analyzer/domain";
import { formatAmount, usdIn, type DisplayUnit } from "./cost-format.js";
import type { DateRange } from "./date-ranges.js";

// Phase 15 step 15.10 (plan §8.4, §11.4; board 3): the Project tab's rules
// as pure functions. The tab looks inside one project; its "why cost
// changed" waterfall compares two months on the priced basis (asked for in
// USD and shown in the picked unit at 1 AI Credit = $0.01, D2).

type Selections = Readonly<Record<string, readonly string[]>>;

export type ProjectScope = { projectId: string; providerId?: string; ignored: string[] } | { reason: string };

export function projectScope(selections: Selections, placeholders: { project: string }): ProjectScope {
  const projects = selections.project ?? [];
  if (projects.length === 0) return { reason: "Select one project in the Project list box to see inside it." };
  if (projects.length > 1) return { reason: `Select one project, not ${projects.length}, to see inside it.` };
  if (projects[0] === placeholders.project) return { reason: "Work outside any project has no project to look inside. Select a project." };
  const providers = selections.provider ?? [];
  const providerId = providers.length === 1 ? providers[0] : undefined;
  const ignored = Object.entries(selections)
    .filter(([field, values]) => values.length > 0 && field !== "project" && !(field === "provider" && providerId !== undefined))
    .map(([field]) => field);
  return { projectId: projects[0]!, ...(providerId !== undefined ? { providerId } : {}), ignored };
}

const addMonths = (month: string, count: number): string => {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, number - 1 + count, 1));
  return date.toISOString().slice(0, 7);
};

export function monthsOf(range: DateRange): string[] {
  const months: string[] = [];
  for (let month = range.since.slice(0, 7); month <= range.until.slice(0, 7); month = addMonths(month, 1)) months.push(month);
  return months;
}

export function defaultPeriods(months: readonly string[]): { a: string; b: string } {
  const b = months.at(-1)!;
  return { a: months.length > 1 ? months[0]! : addMonths(b, -1), b };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

export interface WaterfallStep {
  key: "a" | "usage" | "price" | "mix" | "b";
  label: string;
  // total: a bar from 0; increase/decrease: a floating step (the sign is
  // always written too, never colour alone); none: a zero effect.
  kind: "total" | "increase" | "decrease" | "none";
  value: number; // the bar's amount, signed for effects
  from: number;
  to: number;
}

const effectKind = (value: number): WaterfallStep["kind"] => (value > 0 ? "increase" : value < 0 ? "decrease" : "none");

export function waterfallSteps(row: VarianceCurrency, unit: DisplayUnit, labels: { a: string; b: string }): WaterfallStep[] {
  const shown = (usd: number) => usdIn(usd, unit)!;
  const start = shown(row.costA);
  const steps: WaterfallStep[] = [{ key: "a", label: labels.a, kind: "total", value: start, from: 0, to: start }];
  let level = start;
  for (const [key, label, usd] of [
    ["usage", "Usage", row.usage],
    ["price", "Price", row.price],
    ["mix", "Mix", row.mix],
  ] as const) {
    const value = shown(usd);
    steps.push({ key, label, kind: effectKind(value), value, from: level, to: level + value });
    level += value;
  }
  const end = shown(row.costB);
  steps.push({ key: "b", label: labels.b, kind: "total", value: end, from: 0, to: end });
  return steps;
}

const MINUS = "−";

export function formatSigned(value: number, unit: DisplayUnit): string {
  const text = formatAmount(Math.abs(value), unit);
  if (value > 0) return `+${text}`;
  if (value < 0) return `${MINUS}${text}`;
  return text;
}
