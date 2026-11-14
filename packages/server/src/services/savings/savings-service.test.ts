// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { savingsReportSchema, sessionReplaySchema, type RequestTrace, type Session, type SessionReplay } from "@agent-cost-analyzer/domain";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { UnknownLogProviderIdError } from "../../data-sources/log-providers/registry.js";
import { FakeProvider, shell } from "../../test-support/audit-fakes.js";
import { ANTHROPIC, attributorOn, CacheBreakTraceProvider, counterfactualPricer, SAVINGS_NOW, session, tool, turn, turnPricing } from "../../test-support/savings-fakes.js";
import type { ReplayRequest } from "../session-replay/session-replay-service.js";
import { MAX_ROLLUP_SESSION_LIMIT } from "../tool-audit/audit-query-service.js";
import type { CacheRules } from "./cache-break-classifier.js";
import { CacheBreakDetector } from "./detectors/cache-break-detector.js";
import { CheaperModelDetector } from "./detectors/cheaper-model-detector.js";
import { FailedCallsDetector } from "./detectors/failed-calls-detector.js";
import { UnusedToolsDetector } from "./detectors/unused-tools-detector.js";
import type { DetectorResult, SavingsDetector, SavingsInput } from "./savings-detector.js";
import { SavingsService, type RegisteredDetector } from "./savings-service.js";

// Phase 16 SR10 (docs/plans/savings-report.md §5.2, §11, D3–D5, D8): the
// window's sessions loaded one at a time and bounded, every detector run over
// them, the result ranked. Cancellable between sessions and between
// detectors; the cheaper-model replay only when asked.

const RULES: CacheRules = { known: true, minCacheableTokens: 1024, lifetime: { minMinutes: 5, maxMinutes: 5 }, extendedLifetimeMinutes: 60 };
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T12:00:00.000Z`;

class RecordingDetector implements SavingsDetector {
  readonly inputs: SavingsInput[] = [];
  constructor(
    private readonly result: DetectorResult = { opportunities: [], notAnalysed: [] },
    private readonly onDetect?: () => void,
  ) {}
  detect(input: SavingsInput): DetectorResult {
    this.inputs.push(input);
    this.onDetect?.();
    return this.result;
  }
}

// Counts reads, and how many run at once.
class CountingProvider extends FakeProvider {
  running = 0;
  maxRunning = 0;
  constructor(
    id: string,
    sessions: Session[],
    private readonly onRead?: (reads: number) => void,
  ) {
    super(id, sessions);
  }
  override async readSession(id: string): Promise<Session | null> {
    this.running += 1;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    await Promise.resolve();
    const found = await super.readSession(id);
    this.running -= 1;
    this.onRead?.(this.reads);
    return found;
  }
}

function serviceOver(providers: LogProvider[], detectors: RegisteredDetector[]) {
  return new SavingsService({
    providers: { listProviders: () => providers },
    detectors,
    counterfactual: { snapshot: () => counterfactualPricer() },
    pricer: turnPricing(),
    attribution: { snapshot: () => attributorOn(ANTHROPIC) },
    cacheRules: () => RULES,
    now: () => SAVINGS_NOW,
  });
}

const sessionsOn = (...days: number[]) => days.map((n) => session(`d${n}`, { startedAt: day(n) }));
const idsSeenBy = (detector: RecordingDetector) => detector.inputs[0]!.sessions.map((input) => input.session.id);

describe("SavingsService over every detector", () => {
  // One Claude Code session with an unused MCP server, a failing program
  // called twice and a two-hour pause that lost the cache.
  const busy = session("busy", {
    startedAt: day(15),
    turns: [turn(0, { toolCalls: [shell("foo", "error")] }), turn(1, { toolCalls: [shell("foo", "error")] })],
    toolInventory: [tool("mcp__github__create_issue", 800), tool("Bash", 300, [0, 1])],
  });
  const trace: RequestTrace = {
    sessionId: "busy",
    providerId: "claude-code",
    harness: "claude-code",
    notTraced: [],
    requests: [
      { index: 0, turnIndex: 0, startedAt: "2026-10-15T12:00:00.000Z", model: "claude-sonnet-5", uncachedInput: 100, cacheRead: 0, cacheWrite: 20_000, output: 100 },
      { index: 1, turnIndex: 1, startedAt: "2026-10-15T14:00:00.000Z", model: "claude-sonnet-5", uncachedInput: 100, cacheRead: 0, cacheWrite: 20_000, output: 100 },
    ],
  };
  const replays: ReplayRequest[] = [];
  const comparer = {
    async replay(request: ReplayRequest) {
      replays.push(request);
      const value: SessionReplay = sessionReplaySchema.parse({
        simulated: true,
        sessionId: request.sessionId,
        providerId: request.providerId,
        harness: "claude-code",
        measuredModels: ["claude-sonnet-5"],
        model: request.model,
        vendorId: "anthropic",
        pricing: { channel: "api", asOf: "2026-10-15", requested: "session-channel" },
        currency: "USD",
        turns: [],
        totals: { measured: { value: 1, knownTurns: 2, turns: 2 }, simulated: { value: 0.25, knownTurns: 2, turns: 2 }, difference: -0.75 },
        coverage: { turns: 2, replayedTurns: 2, requests: 2, replayedRequests: 2, notReplayed: [] },
        selfCheck: { model: "claude-sonnet-5", models: ["claude-sonnet-5"], requests: 1, matching: 1, readTolerancePercent: 5, passed: true },
        assumptions: [{ id: "A1", text: "Same conversation.", confidence: "unknown" }],
      });
      return { status: "ok" as const, value };
    },
  };
  const detectors: RegisteredDetector[] = [
    { detector: new UnusedToolsDetector() },
    { detector: new CacheBreakDetector() },
    { detector: new FailedCallsDetector() },
    {
      simulated: true,
      detector: new CheaperModelDetector({ comparer, candidates: { candidatesFor: () => ["claude-haiku-5.5"] }, priceVersions: () => ["anthropic-api:claude-haiku-5.5:2026-10-07"] }),
    },
  ];
  const provider = () => new CacheBreakTraceProvider("claude-code", [busy, session("untraced", { startedAt: day(16) })], new Map([["busy", { trace, promptChanges: new Map() }]]));

  it("finds each opportunity, ranks the priced ones by their high end and keeps the Simulated one apart", async () => {
    const report = await serviceOver([provider()], detectors).report({}, { includeSimulated: true });

    expect(savingsReportSchema.parse(report)).toEqual(report);
    expect(report.window).toEqual({ since: "2026-10-08", until: "2026-11-06", days: 30 });
    expect(new Set(report.opportunities.map((o) => o.kind))).toEqual(new Set(["unused-tools", "idle-cache-expiry", "failed-tool-calls"]));
    const highs = report.opportunities.map((o) => (o.perWindow.known ? o.perWindow.high : -1));
    expect(highs).toEqual([...highs].sort((a, b) => b - a));
    // Both sessions have a known cost; the costlier one is replayed first.
    expect(report.simulated.map((o) => o.key)).toEqual(["cheaper-model:busy:claude-haiku-5.5", "cheaper-model:untraced:claude-haiku-5.5"]);
    // Per week is the window's amount ÷ its 30/7 weeks (D8).
    for (const opportunity of [...report.opportunities, ...report.simulated]) {
      if (opportunity.perWindow.known && opportunity.perWeek.known) expect(opportunity.perWeek.high).toBeCloseTo(opportunity.perWindow.high / (30 / 7), 9);
    }
    // The session with no trace is listed under the cache kind with the reason, not counted as no break.
    expect(report.notAnalysed).toContainEqual({ kind: "idle-cache-expiry", providerId: "claude-code", reason: "The provider has no request trace for this session.", sessions: 1 });
  });

  it("runs no replay unless asked (D5)", async () => {
    replays.length = 0;

    const report = await serviceOver([provider()], detectors).report();

    expect(replays).toEqual([]);
    expect(report.simulated).toEqual([]);
    expect(report.notAnalysed.some((row) => row.kind === "cheaper-model")).toBe(false);
    expect(report.opportunities.length).toBeGreaterThan(0);
  });
});

describe("SavingsService loading", () => {
  it("gives every detector the same input: the window's sessions, the pricing mode and the window", async () => {
    const [first, second] = [new RecordingDetector(), new RecordingDetector()];
    const provider = new FakeProvider("claude-code", [...sessionsOn(10, 20), session("old", { startedAt: "2026-09-01T12:00:00.000Z" })]);

    const report = await serviceOver([provider], [
      { detector: first },
      { detector: second },
    ]).report({ since: "2026-10-01", until: "2026-10-31" }, { pricing: "today" });

    expect(idsSeenBy(first)).toEqual(["d20", "d10"]);
    expect(second.inputs[0]).toBe(first.inputs[0]);
    expect(first.inputs[0]).toMatchObject({ window: { since: "2026-10-01", until: "2026-10-31", days: 31 }, pricing: "today" });
    expect(report.pricing).toBe("today");
    expect(first.inputs[0]!.sessions[0]).toMatchObject({ providerId: "claude-code", channel: ANTHROPIC });
  });

  it("reads the most recent sessions first, one at a time, up to the limit, and lists the rest once, report-wide", async () => {
    const detector = new RecordingDetector();
    const provider = new CountingProvider("claude-code", sessionsOn(10, 12, 14, 16));

    const report = await serviceOver([provider], [
      { detector },
      { detector: new RecordingDetector() },
    ]).report({ limit: 2 });

    expect(idsSeenBy(detector)).toEqual(["d16", "d14"]);
    expect(provider.reads).toBe(2);
    expect(provider.maxRunning).toBe(1);
    const reason = "Over the 2-session cap: only the 2 most recent sessions in the window were read.";
    expect(report.sessionsLeftOut).toEqual([{ providerId: "claude-code", reason, sessions: 2 }]);
    expect(report.notAnalysed).toEqual([]);
  });

  it(`never reads more than ${MAX_ROLLUP_SESSION_LIMIT} sessions, whatever limit is asked (threat model §11)`, async () => {
    const many = Array.from({ length: MAX_ROLLUP_SESSION_LIMIT + 2 }, (_, n) => session(`s${n}`, { startedAt: new Date(Date.parse(day(10)) + n * 60_000).toISOString() }));
    const provider = new FakeProvider("claude-code", many);

    const report = await serviceOver([provider], [{ detector: new RecordingDetector() }]).report({ limit: 10_000 });

    expect(provider.reads).toBe(MAX_ROLLUP_SESSION_LIMIT);
    expect(report.sessionsLeftOut).toEqual([{ providerId: "claude-code", reason: expect.stringContaining(`${MAX_ROLLUP_SESSION_LIMIT}-session cap`), sessions: 2 }]);
  });

  it("caps across providers together, newest first", async () => {
    const detector = new RecordingDetector();
    const a = new FakeProvider("a", [session("a1", { startedAt: day(11) }), session("a2", { startedAt: day(20) })]);
    const b = new FakeProvider("b", [session("b1", { startedAt: day(15) })]);

    const report = await serviceOver([a, b], [{ detector }]).report({ limit: 2 });

    expect(idsSeenBy(detector)).toEqual(["a2", "b1"]);
    expect(report.sessionsLeftOut).toEqual([{ providerId: "a", reason: expect.stringContaining("cap"), sessions: 1 }]);
  });

  it("reads only the provider asked for, and refuses an unknown one", async () => {
    const detector = new RecordingDetector();
    const a = new FakeProvider("a", [session("a1", { startedAt: day(11) })]);
    const b = new FakeProvider("b", [session("b1", { startedAt: day(15) })]);
    const service = serviceOver([a, b], [{ detector }]);

    await service.report({ providerId: "b" });

    expect(idsSeenBy(detector)).toEqual(["b1"]);
    expect(a.reads).toBe(0);
    await expect(service.report({ providerId: "nope" })).rejects.toBeInstanceOf(UnknownLogProviderIdError);
  });

  it("skips a provider whose source is unavailable", async () => {
    class Unavailable extends FakeProvider {
      override async checkAvailability() {
        return { available: false, unavailableReason: "No captures directory" };
      }
    }
    const detector = new RecordingDetector();
    const off = new Unavailable("mitmproxy", sessionsOn(12));

    await serviceOver([off, new FakeProvider("claude-code", sessionsOn(14))], [{ detector }]).report();

    expect(idsSeenBy(detector)).toEqual(["d14"]);
    expect(off.reads).toBe(0);
  });

  it("lists a session whose log can't be read, with a fixed reason, and goes on", async () => {
    class Flaky extends FakeProvider {
      override async readSession(id: string): Promise<Session | null> {
        if (id === "d12") throw new Error("/home/someone/.claude/x.jsonl: EACCES");
        return super.readSession(id);
      }
    }
    const detector = new RecordingDetector();

    const report = await serviceOver([new Flaky("claude-code", sessionsOn(12, 14))], [{ detector }]).report();

    expect(idsSeenBy(detector)).toEqual(["d14"]);
    expect(report.sessionsLeftOut).toEqual([{ providerId: "claude-code", reason: "The session's log could not be read.", sessions: 1 }]);
  });
});

describe("SavingsService cancellation", () => {
  it("stops between sessions and rejects with the signal's AbortError", async () => {
    const controller = new AbortController();
    const detector = new RecordingDetector();
    const provider = new CountingProvider("claude-code", sessionsOn(10, 11, 12, 13), (reads) => reads === 2 && controller.abort());

    await expect(serviceOver([provider], [{ detector }]).report({}, {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });

    expect(provider.reads).toBe(2);
    expect(detector.inputs).toEqual([]);
  });

  it("stops between detectors", async () => {
    const controller = new AbortController();
    const first = new RecordingDetector(undefined, () => controller.abort());
    const second = new RecordingDetector();

    const run = serviceOver([new FakeProvider("claude-code", sessionsOn(10))], [
      { detector: first },
      { detector: second },
    ]).report({}, {}, controller.signal);

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(first.inputs).toHaveLength(1);
    expect(second.inputs).toEqual([]);
  });

  it("reads nothing when the signal is already aborted", async () => {
    const provider = new FakeProvider("claude-code", sessionsOn(10));
    const controller = new AbortController();
    controller.abort();

    await expect(serviceOver([provider], [{ detector: new RecordingDetector() }]).report({}, {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(provider.reads).toBe(0);
  });
});

describe("SavingsService simulated detectors", () => {
  it("runs a simulated detector only with includeSimulated (D5)", async () => {
    const simulated = new RecordingDetector();
    const service = serviceOver([new FakeProvider("claude-code", sessionsOn(10))], [{ detector: simulated, simulated: true }]);

    await service.report();
    expect(simulated.inputs).toEqual([]);

    await service.report({}, { includeSimulated: true });
    expect(simulated.inputs).toHaveLength(1);
  });
});
