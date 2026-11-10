// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { InsightsDataset, Session } from "@agent-cost-analyzer/domain";
import type { SessionRangeFilter } from "../tool-audit/audit-query-service.js";
import { FakeProvider, lookup, sampleSessions, session } from "../../test-support/audit-fakes.js";
import { AnalysisQueryService, type InsightsSource } from "./analysis-query-service.js";
import { UNATTRIBUTED_FIELDS } from "../../test-support/insights-fakes.js";

function insightsSource(): InsightsSource & { filters: SessionRangeFilter[] } {
  const filters: SessionRangeFilter[] = [];
  const dataset: InsightsDataset = {
    generatedAt: "2026-10-01T00:00:00.000Z",
    providers: [{ id: "fake", label: "Fake", available: true, sessionCount: 1, truncated: false }],
    sessions: [{ key: "fake:mid", providerId: "fake", providerLabel: "Fake", sessionId: "mid", title: "Session mid", model: "m", ...UNATTRIBUTED_FIELDS }],
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
        ...UNATTRIBUTED_FIELDS,
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

  describe("activity, judged by the injected clock (docs/plans/mcp-apps.md §4.7)", () => {
    const now = new Date("2026-09-27T09:00:00.000Z");
    const running: Session = (() => {
      const base = session("running", "2026-09-27T08:00:00.000Z", [[], []]);
      return { ...base, turns: base.turns.map((turn, index) => ({ ...turn, startedAt: `2026-09-27T08:${index === 0 ? "00" : "55"}:00.000Z` })) };
    })();

    it("flags a session whose latest turn started within the window as active", async () => {
      const analysis = new AnalysisQueryService(lookup(new FakeProvider("fake", [running])), insightsSource(), {}, () => now);

      expect(await analysis.getSessionCost("running")).toMatchObject({ lastTurnAt: "2026-09-27T08:55:00.000Z", active: true });
    });

    it("flags the rollup's active top sessions", async () => {
      const insights = insightsSource();
      const source: InsightsSource = {
        async getDataset(filter) {
          const dataset = await insights.getDataset(filter);
          return { ...dataset, sessions: dataset.sessions.map((row) => ({ ...row, lastTurnAt: "2026-09-27T08:50:00.000Z" })) };
        },
      };
      const analysis = new AnalysisQueryService(lookup(new FakeProvider("fake", [running])), source, {}, () => now);

      expect((await analysis.getCostRollup({})).topSessions[0]).toMatchObject({ sessionId: "mid", active: true });
    });

    it("exposes the clock so callers describe activity against the same time", () => {
      const analysis = new AnalysisQueryService(lookup(new FakeProvider("fake", [])), insightsSource(), {}, () => now);

      expect(analysis.now()).toBe(now);
    });
  });

  describe("cost basis and attribution (step 15.6)", () => {
    const portal = {
      repository: { attributed: true as const, repository: { key: "github.com/acme/portal", source: "git-remote" as const } },
      projectId: "portal",
      vendor: { known: true as const, vendorId: "anthropic", basis: "profile" as const },
      channel: { known: true as const, channel: "anthropic-api" },
    };
    const priced = { known: true as const, amount: 0.25, currency: "USD" as const, basis: "priced" as const, priceVersionIds: ["v"] };
    const seen: string[] = [];
    const fakePricer = {
      figuresFor: (providerId: string, _session: unknown, turn: { index: number }) => {
        seen.push(`${providerId}:${turn.index}`);
        return { billed: { known: false as const, reason: "x" }, reported: { known: false as const, reason: "x" }, priced };
      },
    };
    const costs = {
      attribution: { snapshot: () => ({ session: () => portal, turn: () => portal }) },
      pricer: { snapshot: () => fakePricer },
    };
    const priceAware = () => new AnalysisQueryService(lookup(new FakeProvider("fake", sampleSessions)), insightsSource(), costs);

    it("prices a session's turns as its provider's and adds its repository and project", async () => {
      const cost = await priceAware().getSessionCost("new");
      expect(cost).toMatchObject({ repositoryKey: "github.com/acme/portal", projectId: "portal" });
      expect(cost?.cost.priced).toMatchObject({ turns: 2, knownTurns: 2, usd: 0.5 });
      expect(seen).toContain("fake:1");
    });

    it("adds the turn's figures to get_turn", async () => {
      const found = await priceAware().getTurn("new", 1);
      expect(found.status === "ok" && found.view.cost.priced).toEqual(priced);
      expect(found.status === "ok" && found.view.preferredCost).toEqual(priced);
    });
  });
});
