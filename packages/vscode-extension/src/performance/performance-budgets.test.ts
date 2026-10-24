import { describe, expect, it } from "vitest";
import { evaluateBudgets, formatBudgetReport, PERFORMANCE_BUDGETS_MS } from "./performance-budgets.js";

describe("evaluateBudgets (vscode-extension.md §3.5 Performance)", () => {
  it("holds the §3.5 budgets: panel first render under 1 s, Sessions tree under 500 ms", () => {
    expect(PERFORMANCE_BUDGETS_MS).toEqual({ "first-render": 1000, "data-ready": 1000, "sessions-tree": 500 });
  });

  it("passes when every budgeted mark is under its budget", () => {
    const report = evaluateBudgets([
      { name: "first-render", durationMs: 400, pageTimeMs: 350 },
      { name: "data-ready", durationMs: 900, pageTimeMs: 850 },
      { name: "sessions-tree", durationMs: 120 },
    ]);

    expect(report).toEqual({
      ok: true,
      results: [
        { name: "first-render", budgetMs: 1000, actualMs: 400, withinBudget: true },
        { name: "data-ready", budgetMs: 1000, actualMs: 900, withinBudget: true },
        { name: "sessions-tree", budgetMs: 500, actualMs: 120, withinBudget: true },
      ],
    });
  });

  it("fails a mark at or over its budget (the budgets are 'under')", () => {
    const report = evaluateBudgets([
      { name: "first-render", durationMs: 1000 },
      { name: "data-ready", durationMs: 1200 },
      { name: "sessions-tree", durationMs: 499.9 },
    ]);

    expect(report.ok).toBe(false);
    expect(report.results.map((result) => [result.name, result.withinBudget])).toEqual([
      ["first-render", false],
      ["data-ready", false],
      ["sessions-tree", true],
    ]);
  });

  it("fails a budget with no mark at all: an unmeasured budget is never a pass", () => {
    const report = evaluateBudgets([{ name: "sessions-tree", durationMs: 10 }]);

    expect(report.ok).toBe(false);
    expect(report.results[0]).toEqual({ name: "first-render", budgetMs: 1000, actualMs: null, withinBudget: false });
  });

  it("judges the latest mark of each name", () => {
    const report = evaluateBudgets([
      { name: "first-render", durationMs: 5000 },
      { name: "first-render", durationMs: 300 },
      { name: "data-ready", durationMs: 400 },
      { name: "sessions-tree", durationMs: 100 },
      { name: "sessions-tree", durationMs: 800 },
    ]);

    expect(report.results.map((result) => result.actualMs)).toEqual([300, 400, 800]);
    expect(report.ok).toBe(false);
  });

  it("takes other budgets, e.g. a looser one for a slow CI machine", () => {
    const report = evaluateBudgets([{ name: "sessions-tree", durationMs: 700 }], { "sessions-tree": 1000 });

    expect(report).toEqual({ ok: true, results: [{ name: "sessions-tree", budgetMs: 1000, actualMs: 700, withinBudget: true }] });
  });

  it("formats a report as one line per budget, for a test's failure message", () => {
    const text = formatBudgetReport(
      evaluateBudgets([
        { name: "first-render", durationMs: 412.345 },
        { name: "data-ready", durationMs: 1500 },
      ]),
    );

    expect(text).toBe(
      ["first-render: 412.3 ms (budget < 1000 ms) ok", "data-ready: 1500.0 ms (budget < 1000 ms) OVER", "sessions-tree: not measured (budget < 500 ms) MISSING"].join(
        "\n",
      ),
    );
  });
});
