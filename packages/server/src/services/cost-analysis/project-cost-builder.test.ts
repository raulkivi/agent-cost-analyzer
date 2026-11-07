// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { projectCostSchema } from "@agent-cost-analyzer/domain";
import { costs, cubeOf, cubeRow, priced, unknownFigure } from "../../test-support/cost-cube-fakes.js";
import { buildCostSeries } from "./time-series-builder.js";
import { buildProjectCost, DEFAULT_TOP_PROJECT_SESSIONS, type ProjectCostQuery } from "./project-cost-builder.js";

// Phase 15 step 15.7 (plan §8.3, §10.1.1 ProjectCost): inside one project —
// the project's cost series plus breakdowns by repository member, vendor →
// model and token type, and its most expensive sessions.

const query: ProjectCostQuery = {
  projectId: "portal",
  projectName: "Customer portal",
  bucket: "month",
  basis: "preferred",
  pricing: "as-of-use",
  currency: "native",
};

const cube = cubeOf([
  cubeRow({ date: "2026-10-02", projectId: "portal", repositoryKey: "github.com/acme/portal-web", sessionKey: "p:w1", model: "claude-sonnet-5.5", uncachedInput: 10, cacheWrite: 20, cacheRead: 30, reasoning: 5, output: 40, cost: costs({ priced: priced(3, "v") }) }),
  cubeRow({ date: "2026-10-03", projectId: "portal", repositoryKey: "github.com/acme/portal-web", sessionKey: "p:w1", model: "claude-sonnet-5.5", uncachedInput: 1, cacheWrite: null, cacheRead: 2, reasoning: null, output: 3, cost: costs({ priced: unknownFigure() }) }),
  cubeRow({ date: "2026-10-04", projectId: "portal", repositoryKey: "local:/home/dev/portal-api", sessionKey: "p:a1", vendorId: "openai", model: "gpt-6.1-sol", cost: costs({ priced: priced(5, "v") }) }),
  cubeRow({ date: "2026-10-04", projectId: "app", sessionKey: "p:x", cost: costs({ priced: priced(50, "v") }) }),
]);

describe("buildProjectCost", () => {
  const cost = projectCostSchema.parse(buildProjectCost(cube, query, []));

  it("is the project's cost series, the same as the time series grouped by that project", () => {
    const series = buildCostSeries(cube, { ...query, groupBy: "project", ids: ["portal"] }, []);
    const seriesPart = Object.fromEntries(Object.entries(cost).filter(([key]) => !["project", "byRepository", "byTokenType", "topSessions"].includes(key)));
    expect(seriesPart).toEqual(series);
    expect(cost.project).toEqual({ id: "portal", name: "Customer portal" });
    expect(cost.total).toMatchObject({ turns: 3, knownTurns: 2, usd: 8 });
  });

  it("breaks the cost down by repository member, with local keys as folder names only", () => {
    expect(byRepositoryKeys(cost)).toEqual([
      ["local:portal-api", 5],
      ["github.com/acme/portal-web", 3],
    ]);
    expect(JSON.stringify(cost)).not.toContain("/home/dev");
  });

  it("gives tokens per model by type, with coverage, unknown counts never summed as 0", () => {
    const sonnet = cost.byTokenType.find((row) => row.model === "claude-sonnet-5.5")!;
    expect(sonnet).toMatchObject({ vendorId: "anthropic", turns: 2 });
    expect(sonnet.cacheWrite).toEqual({ value: 20, knownTurns: 1, turns: 2, estimated: false });
    expect(sonnet.reasoning).toEqual({ value: 5, knownTurns: 1, turns: 2, estimated: false });
    expect(sonnet.output).toEqual({ value: 43, knownTurns: 2, turns: 2, estimated: false });
    expect(cost.byTokenType.map((row) => row.model)).toEqual(["gpt-6.1-sol", "claude-sonnet-5.5"]);
  });

  it("lists the most expensive sessions, up to the number asked for", () => {
    expect(cost.topSessions.map((session) => [session.sessionId, session.turns, session.cost.usd])).toEqual([
      ["a1", 1, 5],
      ["w1", 2, 3],
    ]);
    expect(buildProjectCost(cube, { ...query, topSessions: 1 }, []).topSessions).toHaveLength(1);
    expect(DEFAULT_TOP_PROJECT_SESSIONS).toBe(10);
  });
});

function byRepositoryKeys(cost: { byRepository: { key: string | null; cost: { usd: number | null } }[] }) {
  return cost.byRepository.map((row) => [row.key, row.cost.usd]);
}
