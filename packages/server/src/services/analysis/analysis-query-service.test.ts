import { describe, expect, it } from "vitest";
import type { InsightsDataset } from "@agent-cost-analyzer/domain";
import type { SessionRangeFilter } from "../tool-audit/audit-query-service.js";
import { FakeProvider, lookup, sampleSessions } from "../../test-support/audit-fakes.js";
import { AnalysisQueryService, type InsightsSource } from "./analysis-query-service.js";

function insightsSource(): InsightsSource & { filters: SessionRangeFilter[] } {
  const filters: SessionRangeFilter[] = [];
  const dataset: InsightsDataset = {
    generatedAt: "2026-10-01T00:00:00.000Z",
    providers: [{ id: "fake", label: "Fake", available: true, sessionCount: 1, truncated: false }],
    sessions: [{ key: "fake:mid", providerId: "fake", providerLabel: "Fake", sessionId: "mid", title: "Session mid", model: "m" }],
    turns: [
      {
        key: "fake:mid:0",
        sessionKey: "fake:mid",
        turnIndex: 0,
        model: "m",
        uncachedInput: 1,
        cacheWrite: 0,
        cacheRead: 0,
        reasoning: null,
        output: 1,
        aiCredits: null,
        estimated: false,
        toolCallCount: 2,
      },
    ],
    toolCalls: [],
    findings: [
      { key: "f1", sessionKey: "fake:mid", kind: "security", category: "credential-access", severity: "high", ruleId: "r", title: "t", why: "w" },
    ],
  };
  return {
    filters,
    async getDataset(filter) {
      filters.push(filter);
      return dataset;
    },
  };
}

function service() {
  const insights = insightsSource();
  return { insights, analysis: new AnalysisQueryService(lookup(new FakeProvider("fake", sampleSessions)), insights) };
}

describe("AnalysisQueryService", () => {
  it("builds one session's cost, or null for an unknown session", async () => {
    const { analysis } = service();

    const cost = await analysis.getSessionCost("new", undefined, { topTurns: 1 });
    expect(cost?.turnCount).toBe(2);
    expect(cost?.topTurns).toHaveLength(1);
    expect(await analysis.getSessionCost("missing")).toBeNull();
  });

  it("builds the cost rollup from the insights dataset for the requested range", async () => {
    const { analysis, insights } = service();

    const rollup = await analysis.getCostRollup({ since: "2026-09-01", limit: 5 }, { topSessions: 3 });
    expect(rollup.sessionCount).toBe(1);
    expect(insights.filters).toEqual([{ since: "2026-09-01", limit: 5 }]);
  });

  it("lists findings from the insights dataset", async () => {
    const { analysis } = service();

    const result = await analysis.listFindings({}, { minSeverity: "high" });
    expect(result.findings.map((f) => f.sessionTitle)).toEqual(["Session mid"]);
  });

  it("returns a turn, and distinguishes an unknown session from an unknown turn", async () => {
    const { analysis } = service();

    const found = await analysis.getTurn("new", 1);
    expect(found.status === "ok" && found.view.turnIndex).toBe(1);
    expect(await analysis.getTurn("missing", 0)).toEqual({ status: "unknown-session" });
    expect(await analysis.getTurn("new", 9)).toEqual({ status: "unknown-turn", turnCount: 2 });
  });
});
