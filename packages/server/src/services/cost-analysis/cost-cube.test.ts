// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { InsightsDataset, InsightTurnRow } from "@agent-cost-analyzer/domain";
import { UNATTRIBUTED_FIELDS } from "../../test-support/insights-fakes.js";
import { buildCostCube } from "./cost-cube.js";

// Phase 15 step 15.7 (plan §8, §9 CostCubeBuilder): the flat cost cube, one
// row per turn of the Insights dataset, joined to its session.

const priced = { known: true as const, amount: 2, currency: "USD" as const, basis: "priced" as const, priceVersionIds: ["v"] };
const unknown = { known: false as const, reason: "x" };

function turnRow(key: string, date: string | undefined): InsightTurnRow {
  return {
    key,
    sessionKey: "pi-agent:s1",
    turnIndex: 0,
    model: "gpt-6.1-sol",
    uncachedInput: 10,
    cacheWrite: 0,
    cacheRead: 90,
    reasoning: null,
    output: 5,
    aiCredits: null,
    estimated: false,
    toolCallCount: 0,
    ...UNATTRIBUTED_FIELDS,
    ...(date ? { date } : {}),
    cost: { billed: unknown, reported: unknown, priced },
  };
}

const dataset: InsightsDataset = {
  generatedAt: "2026-11-06T00:00:00.000Z",
  providers: [{ id: "pi-agent", label: "pi", available: true, sessionCount: 1, truncated: false }],
  sessions: [
    {
      key: "pi-agent:s1",
      providerId: "pi-agent",
      providerLabel: "pi",
      sessionId: "s1",
      title: "Session s1",
      model: "gpt-6.1-sol",
      startedAt: "2026-10-08T10:00:00.000Z",
      date: "2026-10-08",
      ...UNATTRIBUTED_FIELDS,
    },
  ],
  turns: [turnRow("pi-agent:s1:0", "2026-10-08"), turnRow("pi-agent:s1:1", undefined)],
  toolCalls: [],
  findings: [],
  projects: [{ id: "portal", name: "Customer portal" }],
  vendors: [{ id: "openai", label: "OpenAI" }],
};

describe("buildCostCube", () => {
  it("joins each dated turn to its session and keeps the attribution, tokens and cost figures", () => {
    const cube = buildCostCube(dataset);
    expect(cube.rows).toHaveLength(1);
    expect(cube.rows[0]).toMatchObject({
      turnKey: "pi-agent:s1:0",
      sessionKey: "pi-agent:s1",
      providerId: "pi-agent",
      sessionId: "s1",
      sessionTitle: "Session s1",
      sessionStartedAt: "2026-10-08T10:00:00.000Z",
      date: "2026-10-08",
      model: "gpt-6.1-sol",
      repositoryKey: null,
      projectId: null,
      cacheRead: 90,
      cost: { priced },
    });
  });

  it("counts turns with no date at all instead of dropping them silently", () => {
    expect(buildCostCube(dataset).undatedTurns).toBe(1);
  });

  it("carries the providers, generation time and display names", () => {
    const cube = buildCostCube(dataset);
    expect(cube.generatedAt).toBe(dataset.generatedAt);
    expect(cube.providers).toEqual(dataset.providers);
    expect(cube.projectName("portal")).toBe("Customer portal");
    expect(cube.projectName("other")).toBe("other");
    expect(cube.vendorLabel("openai")).toBe("OpenAI");
  });
});

// Step 10.19: a turn that ran subagents stays one cube row and keeps its cost lines.
describe("buildCostCube with cost lines", () => {
  it("keeps one row per turn and carries its lines", () => {
    const line = { model: "gpt-6.1-sol", uncachedInput: 1, cacheWrite: 0, cacheRead: 0, reasoning: null, output: 1, aiCredits: 0.5, subagent: true };
    const turns = dataset.turns.map((turn, index) => (index === 0 ? { ...turn, lines: [line] } : turn));
    const cube = buildCostCube({ ...dataset, turns });
    expect(cube.rows).toHaveLength(buildCostCube(dataset).rows.length);
    expect(cube.rows[0]!.lines).toEqual([line]);
    expect(buildCostCube(dataset).rows[0]!.lines).toBeUndefined();
  });
});
