// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costEstimateSchema, type PricingMode, type SessionReplay } from "@agent-cost-analyzer/domain";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../../test-support/vendor-profiles-dir.js";
import { ReplayModelResolver } from "../session-replay/replay-model-resolver.js";
import { REPLAY_ASSUMPTIONS, type ReplayRequest, type ReplayResult, type SessionReplayQueries } from "../session-replay/session-replay-service.js";
import { costs, cubeOf, cubeRow, priced } from "../../test-support/cost-cube-fakes.js";
import type { SessionRangeFilter } from "../tool-audit/audit-query-service.js";
import { EstimateService, MAX_ESTIMATE_REPLAY_SESSIONS, parseEstimateQuery } from "./estimate-service.js";

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

// Phase 14 step 14.5 (analyze-session-replay.md §9, D7; closes Phase 15's
// D17): on another model, each of the target's sessions in the window is
// replayed on it once, and the estimate is made from the simulated costs.
const profiles = loadVendorProfiles(FIXTURE_VENDOR_PROFILES_DIR);

function replayOf(request: ReplayRequest, turns: SessionReplay["turns"], selfCheckPassed: boolean | null): SessionReplay {
  return {
    simulated: true,
    sessionId: request.sessionId,
    providerId: request.providerId ?? "p",
    harness: "claude-code",
    measuredModels: ["claude-sonnet-5.5"],
    model: request.model,
    vendorId: "anthropic",
    pricing: { channel: "api", asOf: "2026-10-01", requested: "session-channel" },
    currency: "USD",
    turns,
    totals: { measured: { value: null, knownTurns: 0, turns: 0 }, simulated: { value: null, knownTurns: 0, turns: 0 }, difference: null },
    coverage: { turns: turns.length, replayedTurns: turns.length, requests: turns.length, replayedRequests: turns.length, notReplayed: [] },
    selfCheck: selfCheckPassed === null ? null : { model: "claude-sonnet-5.5", requests: 1, matching: selfCheckPassed ? 1 : 0, readTolerancePercent: 5, passed: selfCheckPassed },
    assumptions: [REPLAY_ASSUMPTIONS.A1, REPLAY_ASSUMPTIONS.A2],
  };
}

const replayed = (turnIndex: number, cost: SessionReplay["turns"][number]["simulated"] extends infer S ? (S extends { cost: infer C } ? C : never) : never) => ({
  turnIndex,
  measured: { cacheRead: 0, cost: { known: false as const, reason: "n/a" } },
  simulated: { cacheRead: 0, cacheWrite: 0, outcome: "miss" as const, cost },
});

class FakeReplays implements SessionReplayQueries {
  readonly requests: ReplayRequest[] = [];
  constructor(private readonly answer: (request: ReplayRequest) => ReplayResult<SessionReplay>) {}
  async replay(request: ReplayRequest) {
    this.requests.push(request);
    return this.answer(request);
  }
  async compare(): Promise<never> {
    throw new Error("not used");
  }
}

// Five sessions on five days in the project, one turn each (session sN's
// turn simulated at N × 100 AI Credits = $N), and one outside it.
const sessionRows = [
  ...[1, 2, 3, 4, 5].map((n) => cubeRow({ date: `2026-10-0${n}`, sessionKey: `p:s${n}`, turnKey: `p:s${n}:0`, projectId: "app", cost: costs({ priced: priced(1000, "v") }) })),
  cubeRow({ date: "2026-10-01", sessionKey: "p:s9", turnKey: "p:s9:0", projectId: "other", cost: costs({ priced: priced(1, "v") }) }),
];

function modelSetup(replays: FakeReplays | undefined, rows = sessionRows) {
  return new EstimateService({
    cubes: { getCube: async () => cubeOf(rows) },
    projects: { projectName: (id) => (id === "app" ? "App" : undefined) },
    now: () => new Date("2026-11-06T12:00:00.000Z"),
    ...(replays ? { replay: { sessions: replays, models: new ReplayModelResolver(profiles) } } : {}),
  });
}

describe("EstimateService on another model (step 14.5)", () => {
  it("replays each of the target's sessions in the window once on the model, and estimates from the simulated costs", async () => {
    const replays = new FakeReplays((request) => ({
      status: "ok",
      value: replayOf(request, [replayed(0, { known: true, value: Number(request.sessionId.slice(1)) * 100, currency: "AI_CREDITS" })], request.sessionId !== "s5"),
    }));

    const estimate = costEstimateSchema.parse(await modelSetup(replays).estimate({ projectId: "app", unit: "activeDays", planned: 20, weeks: 12, model: "claude-haiku-5-5-20261001" }));

    expect(replays.requests).toEqual(["s1", "s2", "s3", "s4", "s5"].map((sessionId) => ({ sessionId, providerId: "p", model: "claude-haiku-5.5", pricing: "session-channel" })));
    expect(estimate).toMatchObject({
      label: "estimate",
      pricing: "as-of-use",
      history: { units: 5, knownUnits: 5, totalUsd: 15 },
      unitCost: { p50: 3, p90: 4.6 },
      range: { p50: 60, p90: 92 },
      simulation: {
        label: "simulated",
        model: "claude-haiku-5.5",
        vendorId: "anthropic",
        sessions: 5,
        replayedSessions: 5,
        turns: 5,
        replayedTurns: 5,
        notReplayed: [],
        selfCheck: { checked: 5, passed: 4 },
        assumptions: [REPLAY_ASSUMPTIONS.A1, REPLAY_ASSUMPTIONS.A2],
      },
    });
    expect(estimate.simulation?.method).toMatch(/replay/i);
    expect(estimate.conversion).toMatch(/simulated/i);
  });

  it("counts a session it can't replay and a turn not replayed or unpriced by reason, leaving their units out", async () => {
    const replays = new FakeReplays((request) => {
      if (request.sessionId === "s1") return { status: "not-replayable", reason: "This provider's logs can't be replayed yet." };
      if (request.sessionId === "s2") return { status: "unknown-session" };
      if (request.sessionId === "s3")
        return { status: "ok", value: replayOf(request, [{ turnIndex: 0, measured: { cacheRead: null, cost: { known: false, reason: "n/a" } }, simulated: null, notReplayedReason: "A request's cache read is unknown." }], null) };
      if (request.sessionId === "s4") return { status: "ok", value: replayOf(request, [replayed(0, { known: false, reason: "No API price for this model." })], true) };
      return { status: "ok", value: replayOf(request, [replayed(0, { known: true, value: 2, currency: "USD" })], true) };
    });

    const estimate = costEstimateSchema.parse(await modelSetup(replays).estimate({ projectId: "app", unit: "sessions", planned: 3, weeks: 12, model: "claude-haiku-5.5" }));

    expect(estimate).toMatchObject({ history: { units: 5, knownUnits: 1, totalUsd: 2 }, range: null, unitCost: null });
    expect(estimate.refusal).toMatch(/Only 1 session/);
    expect(estimate.simulation).toMatchObject({ sessions: 5, replayedSessions: 3, turns: 5, replayedTurns: 1, selfCheck: { checked: 2, passed: 2 } });
    expect(estimate.simulation?.notReplayed).toEqual(
      expect.arrayContaining([
        { reason: "This provider's logs can't be replayed yet.", turns: 1 },
        { reason: expect.stringMatching(/could not be read/), turns: 1 },
        { reason: "A request's cache read is unknown.", turns: 1 },
        { reason: "No API price for this model.", turns: 1 },
      ]),
    );
  });

  it("refuses a model no vendor profile lists, with the reason, before replaying anything", async () => {
    const replays = new FakeReplays(() => ({ status: "unknown-session" }));

    await expect(modelSetup(replays).estimate({ projectId: "app", unit: "activeDays", planned: 1, weeks: 12, model: "not-a-model" })).rejects.toThrow(/No vendor profile lists the model "not-a-model"/);
    expect(replays.requests).toEqual([]);
  });

  it("refuses a model where no replay is wired (no price book), and still gives null for an unknown project", async () => {
    await expect(modelSetup(undefined).estimate({ projectId: "app", unit: "activeDays", planned: 1, weeks: 12, model: "claude-haiku-5.5" })).rejects.toThrow(/another model isn't available/);
    expect(await modelSetup(new FakeReplays(() => ({ status: "unknown-session" }))).estimate({ projectId: "nope", unit: "activeDays", planned: 1, weeks: 12, model: "claude-haiku-5.5" })).toBeNull();
  });

  it(`refuses more than ${MAX_ESTIMATE_REPLAY_SESSIONS} sessions to replay, suggesting a shorter window`, async () => {
    const replays = new FakeReplays(() => ({ status: "unknown-session" }));
    const many = Array.from({ length: MAX_ESTIMATE_REPLAY_SESSIONS + 1 }, (_, i) => cubeRow({ date: "2026-10-01", sessionKey: `p:m${i}`, turnKey: `p:m${i}:0`, projectId: "app" }));

    await expect(modelSetup(replays, many).estimate({ projectId: "app", unit: "activeDays", planned: 1, weeks: 12, model: "claude-haiku-5.5" })).rejects.toThrow(/4 weeks/);
    expect(replays.requests).toEqual([]);
  });
});
