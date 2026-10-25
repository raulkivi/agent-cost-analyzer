import { describe, expect, it } from "vitest";
import { findingsQueryResultSchema, type InsightFinding, type InsightsDataset } from "@agent-cost-analyzer/domain";
import { queryFindings } from "./findings-query.js";

function finding(key: string, overrides: Partial<InsightFinding> = {}): InsightFinding {
  return {
    key,
    sessionKey: "claude-code:a",
    kind: "security",
    category: "credential-access",
    severity: "high",
    ruleId: "secrets.access",
    title: `finding ${key}`,
    at: "2026-09-27T08:00:00.000Z",
    why: "reads a secrets file",
    ...overrides,
  };
}

function dataset(findings: InsightFinding[]): InsightsDataset {
  return {
    generatedAt: "2026-10-01T00:00:00.000Z",
    providers: [{ id: "claude-code", label: "Claude Code", available: true, sessionCount: 2, truncated: false }],
    sessions: [
      { key: "claude-code:a", providerId: "claude-code", providerLabel: "Claude Code", sessionId: "a", title: "Session A", model: "m" },
      { key: "claude-code:b", providerId: "claude-code", providerLabel: "Claude Code", sessionId: "b", title: "Session B", model: "m" },
    ],
    turns: [],
    toolCalls: [],
    findings,
  };
}

const sample = dataset([
  finding("low", { severity: "low", kind: "behavior-change", category: "new-program", ruleId: "behavior.new-program" }),
  finding("crit", { severity: "critical", category: "remote-code-execution", sessionKey: "claude-code:b" }),
  finding("high-old", { at: "2026-09-01T00:00:00.000Z" }),
  finding("high-new", { at: "2026-09-30T00:00:00.000Z" }),
  finding("anomaly", { kind: "anomaly", severity: "medium", category: "cost-outlier", ruleId: "anomaly.cost-outlier" }),
]);

describe("queryFindings", () => {
  it("returns every finding, most severe then most recent first, resolved to its session", () => {
    const result = queryFindings(sample, {});

    expect(findingsQueryResultSchema.parse(result)).toEqual(result);
    expect(result.findings.map((f) => f.key)).toEqual(["crit", "high-new", "high-old", "anomaly", "low"]);
    expect(result.findings[0]).toMatchObject({ providerId: "claude-code", sessionId: "b", sessionTitle: "Session B" });
    expect(result.total).toBe(5);
    expect(result.bySeverity).toEqual({ info: 0, low: 1, medium: 1, high: 2, critical: 1 });
    expect(result.providers).toEqual(sample.providers);
  });

  it("filters by kind, minimum severity, category and session", () => {
    expect(queryFindings(sample, { kind: ["security"] }).total).toBe(3);
    expect(queryFindings(sample, { minSeverity: "high" }).findings.map((f) => f.key)).toEqual(["crit", "high-new", "high-old"]);
    expect(queryFindings(sample, { category: "COST-OUTLIER" }).findings.map((f) => f.key)).toEqual(["anomaly"]);
    expect(queryFindings(sample, { sessionId: "b" }).findings.map((f) => f.key)).toEqual(["crit"]);
  });

  it("bounds the returned findings by maxResults but reports the full total and severity counts", () => {
    const result = queryFindings(sample, { maxResults: 2 });

    expect(result.findings).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.bySeverity.low).toBe(1);
  });
});
