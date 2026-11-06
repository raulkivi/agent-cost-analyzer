import { describe, expect, it } from "vitest";
import { costRollupSchema, type InsightsDataset, type InsightTurnRow } from "@agent-cost-analyzer/domain";
import { buildCostRollup } from "./cost-rollup-builder.js";
import { UNATTRIBUTED_FIELDS } from "../../test-support/insights-fakes.js";

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
    ...UNATTRIBUTED_FIELDS,
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
      { key: "claude-code:a", providerId: "claude-code", providerLabel: "Claude Code", sessionId: "a", title: "A", model: "model-a", startedAt: "2026-09-27T08:00:00.000Z", date: "2026-09-27", hour: 8, ...UNATTRIBUTED_FIELDS },
      { key: "claude-code:b", providerId: "claude-code", providerLabel: "Claude Code", sessionId: "b", title: "B", model: "model-a", startedAt: "2026-09-27T09:00:00.000Z", date: "2026-09-27", hour: 9, ...UNATTRIBUTED_FIELDS },
      { key: "vscode:c", providerId: "vscode", providerLabel: "VS Code", sessionId: "c", title: "C", model: "model-b", startedAt: "2026-09-28T08:00:00.000Z", date: "2026-09-28", hour: 8, ...UNATTRIBUTED_FIELDS },
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

    expect(rollup.byProvider).toMatchObject([
      { providerId: "claude-code", providerLabel: "Claude Code", sessions: 2, turns: 3, inputTokens: 1200, output: 15, aiCredits: null },
      { providerId: "vscode", providerLabel: "VS Code", sessions: 1, turns: 1, inputTokens: 100, output: null, aiCredits: 2 },
    ]);
    expect(rollup.byModel.map((m) => m.model)).toEqual(["model-a", "model-b"]);
    expect(rollup.daily).toMatchObject([
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

  describe("cost basis (step 15.6)", () => {
    const billed = (amount: number) => ({ known: true as const, amount, currency: "AI_CREDITS" as const, basis: "billed" as const });
    const priced = (amount: number, currency: "AI_CREDITS" | "USD", id: string) => ({
      known: true as const,
      amount,
      currency,
      basis: "priced" as const,
      priceVersionIds: [id],
    });
    const none = { known: false as const, reason: "not recorded" };

    function costed(): InsightsDataset {
      const base = dataset();
      const portal = { repositoryKey: "github.com/acme/portal", projectId: "portal", vendorId: "anthropic", channel: "anthropic-api" };
      const copilot = { repositoryKey: "github.com/acme/api", projectId: null, vendorId: "anthropic", channel: "github-copilot" };
      return {
        ...base,
        vendors: [{ id: "anthropic", label: "Anthropic" }],
        projects: [{ id: "portal", name: "Customer portal" }],
        turns: [
          turnRow("claude-code:a", 0, { ...portal, date: "2026-09-27", cost: { billed: none, reported: none, priced: priced(0.5, "USD", "anthropic-api:m:1") } }),
          turnRow("claude-code:b", 0, { ...portal, date: "2026-09-27", cost: { billed: none, reported: none, priced: none } }),
          turnRow("claude-code:b", 1, { date: "2026-09-27", cost: { billed: none, reported: none, priced: priced(0.25, "USD", "anthropic-api:m:1") } }),
          turnRow("vscode:c", 0, {
            ...copilot,
            model: "model-b",
            aiCredits: 2,
            output: null,
            date: "2026-10-02",
            cost: { billed: billed(2), reported: none, priced: priced(1.6, "AI_CREDITS", "github-copilot:model-b:1") },
          }),
        ],
      };
    }

    it("totals each basis with coverage; the unknown turn is never summed as 0", () => {
      const rollup = buildCostRollup(costed());
      expect(costRollupSchema.parse(rollup)).toEqual(rollup);
      expect(rollup.cost.priced).toMatchObject({ turns: 4, knownTurns: 3 });
      expect(rollup.cost.preferred.amounts).toEqual([
        { currency: "AI_CREDITS", amount: 2, knownTurns: 1 },
        { currency: "USD", amount: 0.75, knownTurns: 2 },
      ]);
      expect(rollup.cost.priceVersionIds).toEqual(["anthropic-api:m:1", "github-copilot:model-b:1"]);
      expect(rollup.byModel.find((m) => m.model === "model-b")?.cost).toMatchObject({ knownTurns: 1, amounts: [{ currency: "AI_CREDITS", amount: 2 }] });
    });

    it("breaks cost down by repository, project, vendor and channel, keeping unknown buckets with their reason", () => {
      const rollup = buildCostRollup(costed());
      expect(rollup.byRepository.map((g) => [g.key, g.label, g.turns])).toEqual([
        ["github.com/acme/portal", "github.com/acme/portal", 2],
        ["github.com/acme/api", "github.com/acme/api", 1],
        [null, "Unattributed", 1],
      ]);
      expect(rollup.byRepository.at(-1)?.reason).toBe(UNATTRIBUTED_FIELDS.unattributedReason);
      expect(rollup.byProject.map((g) => [g.key, g.label, g.turns])).toEqual([
        ["portal", "Customer portal", 2],
        [null, "No project", 2],
      ]);
      expect(rollup.byVendor.map((g) => [g.key, g.label])).toEqual([
        ["anthropic", "Anthropic"],
        [null, "Unknown vendor"],
      ]);
      expect(rollup.byChannel.map((g) => [g.key, g.label])).toEqual([
        ["anthropic-api", "Anthropic API"],
        ["github-copilot", "GitHub Copilot"],
        [null, "Unknown channel"],
      ]);
    });

    it("reconciles Copilot's billed AI Credits with the price book per model and month", () => {
      expect(buildCostRollup(costed()).reconciliation).toEqual([
        {
          month: "2026-10",
          model: "model-b",
          turns: 1,
          billedAiCredits: 2,
          pricedAiCredits: 1.6,
          difference: 0.4,
          ratio: 1.25,
          billedOnlyTurns: 0,
          priceVersionIds: ["github-copilot:model-b:1"],
        },
      ]);
    });

    it("filters by repository or project, over each turn's own attribution", () => {
      const byRepository = buildCostRollup(costed(), { repository: "github.com/acme/portal" });
      expect(byRepository.turnCount).toBe(2);
      expect(byRepository.sessionCount).toBe(2);
      const byProject = buildCostRollup(costed(), { projectId: "portal" });
      expect(byProject.turnCount).toBe(2);
      expect(byProject.topSessions.map((session) => session.sessionId).sort()).toEqual(["a", "b"]);
      expect(buildCostRollup(costed(), { projectId: "none" }).turnCount).toBe(0);
    });

    it("treats a turn row without figures as unknown on every basis", () => {
      const rollup = buildCostRollup(dataset());
      expect(rollup.cost.preferred).toMatchObject({ turns: 4, knownTurns: 0, usd: null });
    });
  });
});
