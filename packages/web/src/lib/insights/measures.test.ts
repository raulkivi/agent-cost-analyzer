import { describe, expect, it } from "vitest";
import { sampleInsightsDataset, turnRow } from "../../test-support/insights-fixture.js";
import {
  aiCreditsByDay,
  computeKpis,
  countBy,
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
      findingsBySeverity: { critical: 1, high: 0, medium: 0, low: 0, info: 1 },
    });
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
