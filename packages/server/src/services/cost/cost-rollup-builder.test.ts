import { describe, expect, it } from "vitest";
import { costRollupSchema, type InsightsDataset, type InsightTurnRow } from "@copilot-cost-analyzer/domain";
import { buildCostRollup } from "./cost-rollup-builder.js";

function turnRow(sessionKey: string, turnIndex: number, overrides: Partial<InsightTurnRow> = {}): InsightTurnRow {
  return {
    key: `${sessionKey}:${turnIndex}`,
    sessionKey,
    turnIndex,
    model: "model-a",
    uncachedInput: 10,
    cacheWrite: 0,
    cacheRead: 90,
    reasoning: null,
    output: 5,
    aiCredits: null,
    estimated: false,
    toolCallCount: 0,
    ...overrides,
  };
}

function dataset(): InsightsDataset {
  return {
    generatedAt: "2026-10-01T00:00:00.000Z",
    since: "2026-09-01",
    providers: [
      { id: "claude-code", label: "Claude Code", available: true, sessionCount: 2, truncated: false },
      { id: "vscode", label: "VS Code", available: true, sessionCount: 1, truncated: false },
      { id: "pi-agent", label: "pi", available: false, unavailableReason: "no sessions dir", sessionCount: 0, truncated: false },
    ],
    sessions: [
      { key: "claude-code:a", providerId: "claude-code", providerLabel: "Claude Code", sessionId: "a", title: "A", model: "model-a", startedAt: "2026-09-27T08:00:00.000Z", date: "2026-09-27", hour: 8 },
      { key: "claude-code:b", providerId: "claude-code", providerLabel: "Claude Code", sessionId: "b", title: "B", model: "model-a", startedAt: "2026-09-27T09:00:00.000Z", date: "2026-09-27", hour: 9 },
      { key: "vscode:c", providerId: "vscode", providerLabel: "VS Code", sessionId: "c", title: "C", model: "model-b", startedAt: "2026-09-28T08:00:00.000Z", date: "2026-09-28", hour: 8 },
    ],
    turns: [
      turnRow("claude-code:a", 0),
      turnRow("claude-code:b", 0, { cacheRead: 990 }),
      turnRow("claude-code:b", 1),
      turnRow("vscode:c", 0, { model: "model-b", aiCredits: 2, output: null }),
    ],
    toolCalls: [],
    findings: [],
  };
}

describe("buildCostRollup", () => {
  it("returns a schema-valid rollup across every provider with coverage", () => {
    const rollup = buildCostRollup(dataset());

    expect(costRollupSchema.parse(rollup)).toEqual(rollup);
    expect(rollup.sessionCount).toBe(3);
    expect(rollup.turnCount).toBe(4);
    expect(rollup.totals.inputTokens.value).toBe(100 + 1000 + 100 + 100);
    expect(rollup.totals.output).toEqual({ value: 15, knownTurns: 3, turns: 4, estimated: false });
    expect(rollup.totals.aiCredits).toEqual({ value: 2, knownTurns: 1, turns: 4, estimated: false });
    expect(rollup.providers).toHaveLength(3);
    expect(rollup.since).toBe("2026-09-01");
  });

  it("breaks spend down by provider, model and day", () => {
    const rollup = buildCostRollup(dataset());

    expect(rollup.byProvider).toEqual([
      { providerId: "claude-code", providerLabel: "Claude Code", sessions: 2, turns: 3, inputTokens: 1200, output: 15, aiCredits: null },
      { providerId: "vscode", providerLabel: "VS Code", sessions: 1, turns: 1, inputTokens: 100, output: null, aiCredits: 2 },
    ]);
    expect(rollup.byModel.map((m) => m.model)).toEqual(["model-a", "model-b"]);
    expect(rollup.daily).toEqual([
      { date: "2026-09-27", sessions: 2, turns: 3, inputTokens: 1200, output: 15, aiCredits: null },
      { date: "2026-09-28", sessions: 1, turns: 1, inputTokens: 100, output: null, aiCredits: 2 },
    ]);
  });

  it("ranks top sessions by input tokens when AI Credits are not known everywhere", () => {
    const rollup = buildCostRollup(dataset(), { topSessions: 2 });

    expect(rollup.rankedBy).toBe("inputTokens");
    expect(rollup.topSessions.map((s) => s.sessionId)).toEqual(["b", "a"]);
    expect(rollup.topSessions[0]).toMatchObject({ providerId: "claude-code", title: "B", turns: 2, inputTokens: 1100 });
  });

  it("returns empty breakdowns for an empty dataset", () => {
    const empty = { ...dataset(), sessions: [], turns: [] };
    const rollup = buildCostRollup(empty);

    expect(rollup.totals.output.value).toBeNull();
    expect(rollup.topSessions).toEqual([]);
    expect(rollup.cacheHitRatio).toBeNull();
  });
});
