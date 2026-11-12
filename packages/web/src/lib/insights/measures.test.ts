// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { findingRow, sampleInsightsDataset, turnRow } from "../../test-support/insights-fixture.js";
import {
  aiCreditsByDay,
  computeKpis,
  costTotalFor,
  countBy,
  formatCostTotal,
  sumWithCoverage,
  tokensByModel,
  toolCallsByTool,
  topSessionsByCredits,
} from "./measures.js";

const dataset = sampleInsightsDataset();

describe("sumWithCoverage", () => {
  it("sums only known figures and reports how many were known", () => {
    expect(sumWithCoverage([1, null, 2.5], (value) => value)).toEqual({ total: 3.5, known: 2, count: 3 });
  });

  it("never turns an all-unknown sum into 0 coverage of something", () => {
    expect(sumWithCoverage([null, null], (value) => value)).toEqual({ total: 0, known: 0, count: 2 });
  });
});

describe("costTotalFor (step 15.6)", () => {
  it("totals the preferred figure per currency, with coverage, never summing unknown as 0", () => {
    const total = costTotalFor(dataset.turns, "preferred");
    expect(total).toMatchObject({ turns: 4, knownTurns: 3 });
    expect(total.amounts).toEqual([
      { currency: "AI_CREDITS", amount: 0.5, knownTurns: 1 },
      { currency: "USD", amount: 0.7, knownTurns: 2 },
    ]);
    expect(total.usd).toBeCloseTo(0.705);
  });

  it("totals one basis for a view (D3)", () => {
    const priced = costTotalFor(dataset.turns, "priced");
    expect(priced.knownTurns).toBe(3);
    expect(priced.amounts.map((amount) => amount.currency)).toEqual(["AI_CREDITS", "USD"]);
    expect(costTotalFor(dataset.turns, "billed").knownTurns).toBe(1);
  });

  it("counts a row without figures as unknown", () => {
    expect(costTotalFor([turnRow("cc:s9", 0)], "preferred")).toMatchObject({ turns: 1, knownTurns: 0, usd: null });
  });
});

describe("formatCostTotal", () => {
  it("shows each currency in its own unit, AI Credits to 2 decimals", () => {
    expect(formatCostTotal(costTotalFor(dataset.turns, "preferred"))).toBe("0.50 AI Credits + $0.70");
  });

  it("is a dash, never 0, when nothing is known", () => {
    expect(formatCostTotal(costTotalFor([turnRow("cc:s9", 0)], "preferred"))).toBe("—");
  });
});

describe("computeKpis", () => {
  it("summarizes the possible rows", () => {
    const kpis = computeKpis(dataset);
    expect(kpis).toMatchObject({
      sessions: 3,
      turns: 4,
      aiCredits: { total: 5.5, known: 3, count: 4 },
      output: { total: 200, known: 4, count: 4 },
      toolCalls: 3,
      failed: 1,
      knownOutcomes: 2,
      failureRate: 0.5,
      securityFindings: 1,
      securityFindingsBySeverity: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
    });
  });

  it("counts only security findings by severity, as the Security signals tile shows them", () => {
    const anomaly = findingRow("cc:s1", { kind: "anomaly", severity: "medium" });
    const kpis = computeKpis({ ...dataset, findings: [...dataset.findings, anomaly] });
    expect(kpis.securityFindings).toBe(1);
    expect(kpis.securityFindingsBySeverity.medium).toBe(0);
  });

  it("computes the cache hit ratio only over turns whose input figures are all known", () => {
    // 3 known turns × (read 800 / input 1000); the cc:s2 turn has an unknown cacheRead.
    expect(computeKpis(dataset).cacheHitRatio).toBeCloseTo(0.8);
    expect(computeKpis({ ...dataset, turns: [turnRow("x", 0, { cacheRead: null })] }).cacheHitRatio).toBeNull();
  });

  it("has a null failure rate when no outcome is known", () => {
    expect(computeKpis({ ...dataset, toolCalls: [dataset.toolCalls[2]!] }).failureRate).toBeNull();
  });
});

describe("chart measures", () => {
  it("adds up AI Credits per session date, oldest first, with coverage", () => {
    expect(aiCreditsByDay(dataset.sessions, dataset.turns)).toEqual([
      { date: "2026-10-09", total: 5, known: 2, count: 2 },
      { date: "2026-10-10", total: 0.5, known: 1, count: 2 },
    ]);
  });

  it("breaks tokens down per model, largest first", () => {
    const rows = tokensByModel(dataset.turns);
    expect(rows.map((row) => row.model)).toEqual(["claude", "gpt-5"]);
    expect(rows[0]).toMatchObject({ uncachedInput: 300, cacheWrite: 300, cacheRead: 1600, reasoning: 0, output: 150 });
  });

  // Step 10.19 (classic subagents plan §4.5): a turn's subagent runs count under their own model.
  it("sums tokens by each cost line's model, so a subagent run's model gets its own tokens", () => {
    const first = dataset.turns[0];
    const line = (model: string, uncachedInput: number, subagent: boolean) => ({
      model,
      uncachedInput,
      cacheWrite: 0,
      cacheRead: 0,
      reasoning: null,
      output: 0,
      aiCredits: null,
      subagent,
    });
    const withRun = { ...first!, model: "claude", uncachedInput: 150, cacheWrite: 0, cacheRead: 0, reasoning: null, output: 0, lines: [line("claude", 100, false), line("haiku-run", 50, true)] };
    const rows = tokensByModel([withRun]);
    expect(rows.map((row) => [row.model, row.uncachedInput])).toEqual([
      ["claude", 100],
      ["haiku-run", 50],
    ]);
  });

  it("counts tool calls per tool as succeeded / failed / unknown", () => {
    expect(toolCallsByTool(dataset.toolCalls)).toEqual([
      { name: "Bash", succeeded: 1, failed: 1, unknown: 0 },
      { name: "run_in_terminal", succeeded: 0, failed: 0, unknown: 1 },
    ]);
  });

  it("counts by an arbitrary key, skipping rows without one, largest first", () => {
    expect(countBy(dataset.toolCalls, (call) => call.program)).toEqual([
      { key: "curl", count: 1 },
      { key: "npm", count: 1 },
      { key: "rg", count: 1 },
    ]);
    expect(countBy(dataset.toolCalls, (call) => call.failureCategory)).toEqual([{ key: "command-not-found", count: 1 }]);
  });

  it("ranks sessions by known AI Credits", () => {
    const top = topSessionsByCredits(dataset.sessions, dataset.turns, 2);
    expect(top.map((row) => [row.session.key, row.aiCredits.total, row.turns])).toEqual([
      ["cc:s1", 5, 2],
      ["vs:s3", 0.5, 1],
    ]);
  });
});
