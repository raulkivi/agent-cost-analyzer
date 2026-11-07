// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { PricingMode } from "@agent-cost-analyzer/domain";
import { costs, cubeOf, cubeRow, priced } from "../../test-support/cost-cube-fakes.js";
import type { SessionRangeFilter } from "../tool-audit/audit-query-service.js";
import { EstimateService, parseEstimateQuery } from "./estimate-service.js";

// Phase 15 step 15.12 (plan §8.6, §10.1.1 estimate_cost): reads one cube at
// today's prices over the window and names the target.

const rows = [1, 2, 3, 4, 5].map((n) => cubeRow({ date: `2026-10-0${n}`, projectId: "app", repositoryKey: "local:/home/dev/app", cost: costs({ priced: priced(n * 10, "v") }) }));

function setup() {
  const requests: { range: SessionRangeFilter; pricing: PricingMode }[] = [];
  const service = new EstimateService({
    cubes: { getCube: async (range, pricing) => (requests.push({ range, pricing }), cubeOf(rows)) },
    projects: { projectName: (id) => (id === "app" ? "App" : undefined) },
    now: () => new Date("2026-11-06T12:00:00.000Z"),
  });
  return { service, requests };
}

describe("parseEstimateQuery", () => {
  it("reads a project or repository, active days or sessions, and the history window (12 weeks by default)", () => {
    expect(parseEstimateQuery({ projectId: "app", activeDays: "20" })).toEqual({ ok: true, value: { projectId: "app", unit: "activeDays", planned: 20, weeks: 12 } });
    expect(parseEstimateQuery({ repository: "github.com/a/b", sessions: "8", historyWeeks: "4", provider: "vscode" })).toEqual({
      ok: true,
      value: { repository: "github.com/a/b", unit: "sessions", planned: 8, weeks: 4, providerId: "vscode" },
    });
  });

  it("needs exactly one target and one amount, a whole number from 1, and 4 or 12 weeks", () => {
    for (const query of [{ activeDays: "20" }, { projectId: "a", repository: "b", activeDays: "20" }, { projectId: "a" }, { projectId: "a", activeDays: "20", sessions: "3" }, { projectId: "a", activeDays: "0" }, { projectId: "a", activeDays: "2.5" }, { projectId: "a", activeDays: "20", historyWeeks: "8" }]) {
      expect(parseEstimateQuery(query).ok, JSON.stringify(query)).toBe(false);
    }
  });
});

describe("EstimateService", () => {
  it("reads the window's sessions at today's prices and names the project", async () => {
    const { service, requests } = setup();
    const estimate = await service.estimate({ projectId: "app", unit: "activeDays", planned: 20, weeks: 12, providerId: "vscode" });
    expect(requests).toEqual([{ range: { providerId: "vscode", since: "2026-08-15", until: "2026-11-06" }, pricing: "today" }]);
    expect(estimate).toMatchObject({ target: { groupBy: "project", id: "app", name: "App" }, range: { p50: 600, p90: 920 } });
  });

  it("names a local repository by its folder only, and gives null for an unknown project", async () => {
    const { service } = setup();
    expect((await service.estimate({ repository: "local:/home/dev/app", unit: "activeDays", planned: 1, weeks: 12 }))?.target).toEqual({ groupBy: "repository", id: "local:app", name: "local:app" });
    expect(await service.estimate({ projectId: "nope", unit: "activeDays", planned: 1, weeks: 12 })).toBeNull();
  });
});
