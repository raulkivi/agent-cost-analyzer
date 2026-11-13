// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { savingsActionText, savingsReportSchema, sessionReplaySchema, type CostFigure, type SessionReplay } from "@agent-cost-analyzer/domain";
import { savingsInput, session, sessionInput } from "../../../test-support/savings-fakes.js";
import type { ReplayRequest, ReplayResult } from "../../session-replay/session-replay-service.js";
import type { SavingsSessionInput } from "../savings-detector.js";
import { CheaperModelDetector, type CheaperModelCandidates, type ReplayComparer } from "./cheaper-model-detector.js";

// Phase 16 SR8 (docs/plans/savings-report.md §4 O6, §7, D3, D5): the top
// sessions by cost replayed on up to 3 cheaper documented models, through a
// ReplayComparer port (a fake here). Every saving is Simulated, carries the
// replay's self-check, coverage and assumption A1, and never joins the ranked
// list. The fake replay says what each model's simulated cost is.
const WEEKS = 30 / 7;
const A1 = { id: "A1", text: "Same conversation: the other model is assumed to get the same prompts.", confidence: "unknown" } as const;

const priced = (amount: number): CostFigure => ({ known: true, amount, currency: "USD", basis: "priced", priceVersionIds: ["anthropic-api:m:2026-10-01"] });

interface ReplayShape {
  measured?: number;
  simulated?: number | null;
  selfCheck?: SessionReplay["selfCheck"];
  coverage?: SessionReplay["coverage"];
  channel?: "api" | "copilot" | null;
}

function replayOf(request: ReplayRequest, shape: ReplayShape = {}): SessionReplay {
  const measured = shape.measured ?? 1;
  const simulated = shape.simulated === undefined ? 0.25 : shape.simulated;
  const total = (value: number | null) => ({ value, knownTurns: value === null ? 0 : 2, turns: 2 });
  const channel = shape.channel === undefined ? "api" : shape.channel;
  return sessionReplaySchema.parse({
    simulated: true,
    sessionId: request.sessionId,
    providerId: request.providerId ?? "claude-code",
    harness: "claude-code",
    measuredModels: ["claude-opus-5"],
    model: request.model,
    vendorId: "anthropic",
    pricing: { ...(channel === null ? { channel: null, reason: "No channel is known." } : { channel }), asOf: "2026-10-15", requested: "session-channel" },
    currency: "USD",
    turns: [],
    totals: { measured: total(measured), simulated: total(simulated), difference: simulated === null ? null : simulated - measured },
    coverage: shape.coverage ?? { turns: 2, replayedTurns: 2, requests: 8, replayedRequests: 8, notReplayed: [] },
    selfCheck: shape.selfCheck === undefined ? { model: "claude-opus-5", requests: 8, matching: 8, readTolerancePercent: 5, passed: true } : shape.selfCheck,
    assumptions: [A1],
  });
}

class FakeComparer implements ReplayComparer {
  readonly calls: ReplayRequest[] = [];
  constructor(private readonly answer: (request: ReplayRequest) => ReplayResult<SessionReplay> = (request) => ({ status: "ok", value: replayOf(request) })) {}
  async replay(request: ReplayRequest): Promise<ReplayResult<SessionReplay>> {
    this.calls.push(request);
    return this.answer(request);
  }
}

const candidates = (...models: string[]): CheaperModelCandidates => ({ candidatesFor: () => models });
const versions = () => ["anthropic-api:claude-haiku-5.5:2026-10-07"];

// A session with a known cost: its turns' priced figures sum to `cost`.
function costly(id: string, cost: number, overrides: Partial<SavingsSessionInput> = {}): SavingsSessionInput {
  return sessionInput(session(id, { model: "claude-opus-5" }), { turnCosts: new Map([[0, priced(cost)]]), ...overrides });
}

function detectorOf(comparer: ReplayComparer, models: CheaperModelCandidates = candidates("claude-sonnet-5", "claude-haiku-5.5")) {
  return new CheaperModelDetector({ comparer, candidates: models, priceVersions: versions });
}

describe("CheaperModelDetector", () => {
  it("replays a session on each cheaper model and reports the saving as Simulated, with its self-check, coverage and A1", async () => {
    const comparer = new FakeComparer((request) => ({ status: "ok", value: replayOf(request, { measured: 1, simulated: request.model === "claude-haiku-5.5" ? 0.1 : 0.4 }) }));

    const { opportunities, notAnalysed } = await detectorOf(comparer).detect(savingsInput([costly("s1", 1)]));

    expect(notAnalysed).toEqual([]);
    expect(opportunities.map((o) => o.key)).toEqual(["cheaper-model:s1:claude-sonnet-5", "cheaper-model:s1:claude-haiku-5.5"]);
    const haiku = opportunities[1]!;
    expect(haiku).toMatchObject({
      kind: "cheaper-model",
      subject: "claude-haiku-5.5",
      sessions: [{ providerId: "claude-code", sessionId: "s1" }],
      evidence: { sessions: 1, requests: 8, tokens: null, occurrences: 2 },
      // 10% of what it cost; the replay matched the log on 8 of 8 requests.
      actionParams: { model: "claude-haiku-5.5", percent: 10, matchPercent: 100 },
      simulation: {
        model: "claude-haiku-5.5",
        selfCheck: { requests: 8, matching: 8, passed: true },
        coverage: { turns: 2, replayedTurns: 2, requests: 8, replayedRequests: 8 },
        assumptions: [{ id: "A1", text: expect.stringContaining("Same conversation") }],
      },
      inferred: false,
      coverage: { sessionsInWindow: 1, sessionsAnalysed: 1, notAnalysed: [] },
    });
    // The saving is measured − simulated: 1 − 0.1, one estimate, labelled Simulated.
    expect(haiku.perWindow).toMatchObject({ known: true, currency: "USD", basis: "simulated", label: "simulated", priceVersionIds: ["anthropic-api:claude-haiku-5.5:2026-10-07"] });
    expect(haiku.perWindow.known && [haiku.perWindow.low, haiku.perWindow.high]).toEqual([expect.closeTo(0.9, 9), expect.closeTo(0.9, 9)]);
    expect(haiku.perWeek.known && haiku.perWeek.high).toBeCloseTo(0.9 / WEEKS, 9);
    expect(savingsActionText("cheaper-model", haiku.actionParams)).toContain("claude-haiku-5.5");
  });

  it("never lets a Simulated opportunity into the ranked list: only the report's simulated section accepts it", async () => {
    const { opportunities } = await detectorOf(new FakeComparer()).detect(savingsInput([costly("s1", 1)]));
    const report = { window: { since: "2026-10-07", until: "2026-11-06", days: 30 }, pricing: "as-of-use", opportunities: [], simulated: [], notAnalysed: [] } as const;

    expect(opportunities.length).toBeGreaterThan(0);
    expect(opportunities.every((o) => o.kind === "cheaper-model" && o.perWindow.known && o.perWindow.basis === "simulated")).toBe(true);
    expect(savingsReportSchema.safeParse({ ...report, simulated: opportunities }).success).toBe(true);
    expect(savingsReportSchema.safeParse({ ...report, opportunities }).success).toBe(false);
  });

  it("replays only the 5 most expensive sessions, and says the others were not looked at", async () => {
    const comparer = new FakeComparer();
    const sessions = [3, 1, 7, 5, 2, 6, 4].map((cost) => costly(`s${cost}`, cost));

    const { opportunities } = await detectorOf(comparer, candidates("claude-haiku-5.5")).detect(savingsInput(sessions));

    expect(comparer.calls.map((call) => call.sessionId)).toEqual(["s7", "s6", "s5", "s4", "s3"]);
    expect(opportunities).toHaveLength(5);
    expect(opportunities[0]!.coverage).toEqual({
      sessionsInWindow: 7,
      sessionsAnalysed: 5,
      notAnalysed: [{ reason: "Not among the 5 most expensive replayable sessions.", sessions: 2 }],
    });
  });

  it("replays on at most 3 cheaper models", async () => {
    const comparer = new FakeComparer();

    await detectorOf(comparer, candidates("a-1", "b-2", "c-3", "d-4", "e-5")).detect(savingsInput([costly("s1", 1)]));

    expect(comparer.calls.map((call) => call.model)).toEqual(["a-1", "b-2", "c-3"]);
  });

  it("reports no opportunity where the other model would not have cost less", async () => {
    const comparer = new FakeComparer((request) => ({ status: "ok", value: replayOf(request, { measured: 1, simulated: 1.5 }) }));

    expect(await detectorOf(comparer).detect(savingsInput([costly("s1", 1)]))).toEqual({ opportunities: [], notAnalysed: [] });
  });
});

describe("CheaperModelDetector: Not analysed (never 0)", () => {
  it("lists a session the provider can't replay, by reason, and spends no place of the 5 on it", async () => {
    const comparer = new FakeComparer((request) =>
      request.sessionId === "pi" ? { status: "not-replayable", reason: "This provider's logs can't be replayed yet." } : { status: "ok", value: replayOf(request) },
    );
    const sessions = [costly("pi", 100, { providerId: "pi-agent" }), ...[5, 4, 3, 2, 1].map((cost) => costly(`s${cost}`, cost))];

    const { opportunities, notAnalysed } = await detectorOf(comparer, candidates("claude-haiku-5.5")).detect(savingsInput(sessions));

    expect(notAnalysed).toEqual([{ kind: "cheaper-model", providerId: "pi-agent", reason: "This provider's logs can't be replayed yet.", sessions: 1 }]);
    expect(opportunities).toHaveLength(5);
    expect(comparer.calls.filter((call) => call.sessionId === "pi")).toHaveLength(1);
    expect(opportunities[0]!.coverage).toMatchObject({ sessionsInWindow: 6, sessionsAnalysed: 5, notAnalysed: [{ reason: "This provider's logs can't be replayed yet.", sessions: 1 }] });
  });

  it("lists sessions with no known cost or no documented cheaper model", async () => {
    const noCost = sessionInput(session("nc"), { turnCosts: new Map([[0, { known: false, reason: "No price." } as CostFigure]]) });
    const noCosts = sessionInput(session("nm"));
    const comparer = new FakeComparer();
    const detector = new CheaperModelDetector({ comparer, candidates: { candidatesFor: (model) => (model === "claude-opus-5" ? ["claude-haiku-5.5"] : []) }, priceVersions: versions });

    const { opportunities, notAnalysed } = await detector.detect(
      savingsInput([noCost, noCosts, sessionInput(session("nm2", { model: "claude-haiku-5.5" }), { turnCosts: new Map([[0, priced(1)]]) })]),
    );

    expect(opportunities).toEqual([]);
    expect(comparer.calls).toEqual([]);
    expect(notAnalysed.map((entry) => entry.reason)).toEqual([
      "No cheaper model of the same vendor is documented for this model.",
      "No turn's cost is known, so the session can't be ranked by cost.",
      "The session's turn costs were not given, so it can't be ranked by cost.",
    ]);
  });

  it("lists a model the replay can't run on, and keeps the other models' savings", async () => {
    const comparer = new FakeComparer((request) =>
      request.model === "claude-sonnet-5" ? { status: "unknown-model", reason: "No vendor profile lists the model." } : { status: "ok", value: replayOf(request) },
    );

    const { opportunities, notAnalysed } = await detectorOf(comparer).detect(savingsInput([costly("s1", 1)]));

    expect(opportunities.map((o) => o.subject)).toEqual(["claude-haiku-5.5"]);
    expect(notAnalysed).toEqual([{ kind: "cheaper-model", providerId: "claude-code", reason: "No vendor profile lists the model.", sessions: 1 }]);
  });

  it("refuses to claim a saving when the replay can't be checked against the log or can't be priced", async () => {
    const unchecked = new FakeComparer((request) => ({ status: "ok", value: replayOf(request, { selfCheck: null }) }));
    const unpriced = new FakeComparer((request) => ({ status: "ok", value: replayOf(request, { simulated: null, channel: null }) }));

    const first = await detectorOf(unchecked, candidates("claude-haiku-5.5")).detect(savingsInput([costly("s1", 1)]));
    const second = await detectorOf(unpriced, candidates("claude-haiku-5.5")).detect(savingsInput([costly("s1", 1)]));

    expect(first.opportunities).toEqual([]);
    expect(first.notAnalysed).toEqual([{ kind: "cheaper-model", providerId: "claude-code", reason: "The replay's own model has no vendor profile to check it against the log, so its figures can't be trusted.", sessions: 1 }]);
    expect(second.opportunities).toEqual([]);
    expect(second.notAnalysed).toEqual([{ kind: "cheaper-model", providerId: "claude-code", reason: "No channel is known.", sessions: 1 }]);
  });

  it("states the self-check's match rate as it is, and an unknown amount when no price version is known", async () => {
    const comparer = new FakeComparer((request) => ({ status: "ok", value: replayOf(request, { selfCheck: { model: "claude-opus-5", requests: 8, matching: 6, readTolerancePercent: 5, passed: false } }) }));
    const detector = new CheaperModelDetector({ comparer, candidates: candidates("claude-haiku-5.5"), priceVersions: () => [] });

    const { opportunities } = await detector.detect(savingsInput([costly("s1", 1)]));

    expect(opportunities[0]).toMatchObject({
      actionParams: { matchPercent: 75 },
      simulation: { selfCheck: { matching: 6, passed: false } },
      perWindow: { known: false, reason: expect.stringContaining("price version") },
      perWeek: { known: false },
    });
  });
});

describe("CheaperModelDetector: golden report", () => {
  it("over a multi-session window (update with `vitest -u` after checking the diff by hand)", async () => {
    const comparer = new FakeComparer((request) =>
      request.sessionId === "pi"
        ? { status: "not-replayable", reason: "This provider's logs can't be replayed yet." }
        : { status: "ok", value: replayOf(request, { measured: 2, simulated: request.model === "claude-haiku-5.5" ? 0.3 : 1.1 }) },
    );
    const sessions = [costly("cc-big", 2), costly("cc-small", 0.5), costly("pi", 9, { providerId: "pi-agent" }), sessionInput(session("nocost"))];

    const result = await detectorOf(comparer).detect(savingsInput(sessions));

    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot("../__golden__/savings-cheaper-model-report.json");
  });
});
