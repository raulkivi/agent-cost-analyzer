import type { TimingMark, TimingMarkName } from "./performance-recorder.js";

// The §3.5 Performance budgets (vscode-extension.md), in ms; each is
// "under". The panel's first render is held to 1 s both as the first paint
// and as the first list on screen (with 200 sessions in the integration
// fixture). "Interactions respond in under 100 ms" has no mark yet, so it
// isn't judged here.
export const PERFORMANCE_BUDGETS_MS = {
  "first-render": 1000,
  "data-ready": 1000,
  "sessions-tree": 500,
} as const satisfies Partial<Record<TimingMarkName, number>>;

export type PerformanceBudgets = Partial<Record<TimingMarkName, number>>;

export interface BudgetResult {
  name: TimingMarkName;
  budgetMs: number;
  // The latest mark's duration, or null when it was never measured.
  actualMs: number | null;
  withinBudget: boolean;
}

export interface BudgetReport {
  // Every budget measured and under.
  ok: boolean;
  results: BudgetResult[];
}

// Judges the latest mark of each budgeted name against its budget. A budget
// with no mark fails: an unmeasured budget is never reported as met.
export function evaluateBudgets(marks: readonly TimingMark[], budgets: PerformanceBudgets = PERFORMANCE_BUDGETS_MS): BudgetReport {
  const results = Object.entries(budgets).map(([name, budgetMs]): BudgetResult => {
    const latest = marks.findLast((mark) => mark.name === name);
    const actualMs = latest?.durationMs ?? null;
    return { name: name as TimingMarkName, budgetMs, actualMs, withinBudget: actualMs !== null && actualMs < budgetMs };
  });
  return { ok: results.every((result) => result.withinBudget), results };
}

// One line per budget, for a test's failure message.
export function formatBudgetReport(report: BudgetReport): string {
  return report.results
    .map(({ name, budgetMs, actualMs, withinBudget }) => {
      const actual = actualMs === null ? "not measured" : `${actualMs.toFixed(1)} ms`;
      const verdict = actualMs === null ? "MISSING" : withinBudget ? "ok" : "OVER";
      return `${name}: ${actual} (budget < ${budgetMs} ms) ${verdict}`;
    })
    .join("\n");
}
