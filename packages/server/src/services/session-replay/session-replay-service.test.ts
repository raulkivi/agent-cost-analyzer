// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHANNEL,
  MAX_COMPARED_MODELS,
  channelCurrency,
  vendorApiChannel,
  sessionReplayComparisonSchema,
  sessionReplaySchema,
  unavailableTokenCount,
  unknownCost,
  type CostFigure,
  type RequestTrace,
  type Session,
  type TokenCount,
  type TraceRequest,
  type Turn,
} from "@agent-cost-analyzer/domain";
import type {
  LogProvider,
  RequestTraceReader,
} from "../../data-sources/log-providers/log-provider.js";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { FakeProvider } from "../../test-support/audit-fakes.js";
import type { Attribution } from "../cost-attribution/session-attributor.js";
import type { SessionCostSources } from "../analysis/analysis-query-service.js";
import { NOT_ATTRIBUTED } from "../insights/insights-dataset-builder.js";
import {
  simulateScenario,
  type SimulateOptions,
} from "../learn-simulation/simulate-scenario.js";
import type { PricingRequest } from "../pricing/cost-pricer.js";
import {
  billedFigure,
  reportedFigure,
  type PricedFigureSource,
} from "../pricing/turn-cost-figures.js";
import type { ProviderLookup } from "../tool-audit/audit-query-service.js";
import { ReplayModelResolver } from "./replay-model-resolver.js";
import {
  MAX_REPLAY_REQUESTS,
  NOT_REPLAYABLE_PROVIDER_REASON,
  REPLAY_ASSUMPTIONS,
  SessionReplayService,
  TooManyComparedModelsError,
  type SessionReplayDeps,
} from "./session-replay-service.js";

// Phase 14 step 14.4 (docs/plans/analyze-session-replay.md §4, §7, D2):
// SessionReplayService composes the trace, scripter, simulator, pricer,
// aligner and self-check over narrow ports; these tests pass fakes for the
// providers, the prices and the session's own cost sources, with the real
// vendor profiles (data) so model ids resolve as they will in the products.

const here = path.dirname(fileURLToPath(import.meta.url));
const profiles = loadVendorProfiles(
  path.resolve(here, "../../../fixtures/vendor-profiles"),
);

const k = (value: number): TokenCount => ({ known: true, value });

// Each request is its own turn and grows the prompt by 500 new tokens: the
// first writes the whole prompt, every later one reads the previous prompt
// and writes the new part (a clean, always-hit trace).
function request(
  index: number,
  model: string,
  overrides: Partial<TraceRequest> = {},
): TraceRequest {
  const prompt = 2000 + index * 600;
  const previousPrompt = index === 0 ? 0 : prompt - 600;
  const cacheRead = index === 0 ? 0 : previousPrompt;
  return {
    index,
    turnIndex: index,
    startedAt: new Date(
      Date.parse("2026-10-10T10:00:00.000Z") + index * 60_000,
    ).toISOString(),
    model,
    uncachedInput: 0,
    cacheRead,
    cacheWrite: prompt - cacheRead,
    output: 100,
    ...overrides,
  };
}

function traceOf(
  providerId: string,
  harness: RequestTrace["harness"],
  models: string[],
  overrides: Partial<RequestTrace> = {},
): RequestTrace {
  return {
    sessionId: "s-1",
    providerId,
    harness,
    requests: models.map((model, index) => request(index, model)),
    notTraced: [],
    ...overrides,
  };
}

function turnOf(index: number, model: string, costAiCredits: TokenCount): Turn {
  return {
    index,
    userMessage: "",
    assistantResponse: "",
    toolCalls: [],
    usage: {
      uncachedInput: k(0),
      cacheWrite: k(0),
      cacheRead: k(index * 100),
      tool: unavailableTokenCount("n/a"),
      vision: unavailableTokenCount("n/a"),
      reasoning: unavailableTokenCount("n/a"),
      output: k(100),
      costAiCredits,
      model,
    },
    explanation: "",
    startedAt: new Date(
      Date.parse("2026-10-10T10:00:00.000Z") + index * 60_000,
    ).toISOString(),
  };
}

function sessionOf(providerId: string, turns: Turn[], id = "s-1"): Session {
  return {
    id,
    mode: "analyze",
    providerId,
    title: "Session",
    model: turns[0]?.usage.model ?? "m",
    turns,
    turnCount: turns.length,
    costAiCredits: unavailableTokenCount("n/a"),
    usageDataAvailable: true,
    startedAt: turns[0]?.startedAt ?? "2026-10-10T10:00:00.000Z",
  };
}

// Copilot sessions bill each turn in AI Credits (2 per turn here).
function copilotSession(models: string[]): Session {
  return sessionOf(
    "vscode",
    models.map((model, index) => turnOf(index, model, k(2))),
  );
}

function claudeCodeSession(models: string[]): Session {
  return sessionOf(
    "claude-code",
    models.map((model, index) =>
      turnOf(
        index,
        model,
        unavailableTokenCount(
          "AI Credits are GitHub Copilot's own billing unit.",
        ),
      ),
    ),
  );
}

class TraceProvider extends FakeProvider implements RequestTraceReader {
  constructor(
    id: string,
    sessions: Session[],
    private readonly traces: RequestTrace[],
  ) {
    super(id, sessions);
  }
  async readRequestTrace(sessionId: string): Promise<RequestTrace | null> {
    return this.traces.find((trace) => trace.sessionId === sessionId) ?? null;
  }
}

function lookupOf(...providers: LogProvider[]): ProviderLookup {
  return {
    getActiveProvider: () => providers[0]!,
    getProvider: (id) => {
      const found = providers.find((provider) => provider.id === id);
      if (!found) throw new Error(`unknown provider ${id}`);
      return found;
    },
  };
}

// The price of one simulated request: 1 in the channel's currency, unless
// the model is one the fake book doesn't price. Records every request.
class FakePrices implements PricedFigureSource {
  readonly requests: PricingRequest[] = [];
  constructor(private readonly unpriced: string[] = []) {}
  price(request: PricingRequest): CostFigure {
    this.requests.push(request);
    if (!request.channel.known) return unknownCost(request.channel.reason);
    if (this.unpriced.includes(request.usage.model))
      return unknownCost(`No price for ${request.usage.model}.`);
    return {
      known: true,
      amount: 1,
      currency: channelCurrency(request.channel.channel),
      basis: "priced",
    };
  }
}

const CHANNELS: Record<string, string> = {
  vscode: CHANNEL.githubCopilot,
  "claude-code": CHANNEL.anthropicApi,
};

function attributionFor(providerId: string): Attribution {
  const channel = CHANNELS[providerId];
  return {
    ...NOT_ATTRIBUTED,
    channel: channel
      ? { known: true, channel }
      : { known: false, reason: `No channel for ${providerId}.` },
  };
}

// The session's own figures: billed from the log; priced at $0.5 per turn
// on any API channel, unknown on Copilot (as if the book had no price).
const costSources: SessionCostSources = {
  attribution: {
    snapshot: () => ({
      session: (providerId) => attributionFor(providerId),
      turn: (providerId) => attributionFor(providerId),
    }),
  },
  pricer: {
    snapshot: () => ({
      figuresFor: (_providerId, _session, turn, attribution) => ({
        billed: billedFigure(turn.usage),
        reported: reportedFigure(turn.usage),
        priced:
          attribution.channel.known &&
          attribution.channel.channel !== CHANNEL.githubCopilot
            ? { known: true, amount: 0.5, currency: "USD", basis: "priced" }
            : unknownCost("No Copilot price in this fake."),
      }),
    }),
  },
};

function serviceOf(
  providers: LogProvider[],
  overrides: Partial<SessionReplayDeps> = {},
  prices = new FakePrices(),
) {
  return new SessionReplayService({
    providers: lookupOf(...providers),
    profiles,
    prices: { snapshot: () => prices },
    costs: costSources,
    ...overrides,
  });
}

const copilotProvider = (models: string[], trace?: Partial<RequestTrace>) =>
  new TraceProvider(
    "vscode",
    [copilotSession(models)],
    [traceOf("vscode", "vscode-local", models, trace)],
  );
const claudeCodeProvider = (models: string[], trace?: Partial<RequestTrace>) =>
  new TraceProvider(
    "claude-code",
    [claudeCodeSession(models)],
    [traceOf("claude-code", "claude-code", models, trace)],
  );

const SONNET = "claude-sonnet-5";
const FOUR_SONNET = [SONNET, SONNET, SONNET, SONNET];

describe("SessionReplayService.replay: refusals", () => {
  it("is an unknown session when the provider has no such session", async () => {
    const service = serviceOf([copilotProvider(FOUR_SONNET)]);
    await expect(
      service.replay({ sessionId: "nope", model: "gpt-6.1-sol" }),
    ).resolves.toEqual({ status: "unknown-session" });
  });

  it("is not replayable when the provider reads no request traces (D1)", async () => {
    const service = serviceOf([
      new FakeProvider("pi-agent", [copilotSession(FOUR_SONNET)]),
    ]);
    await expect(
      service.replay({ sessionId: "s-1", model: "gpt-6.1-sol" }),
    ).resolves.toEqual({
      status: "not-replayable",
      reason: NOT_REPLAYABLE_PROVIDER_REASON,
    });
  });

  it("is an unknown session when the provider has the session but no trace for it", async () => {
    const provider = new TraceProvider(
      "vscode",
      [copilotSession(FOUR_SONNET)],
      [],
    );
    await expect(
      serviceOf([provider]).replay({ sessionId: "s-1", model: "gpt-6.1-sol" }),
    ).resolves.toEqual({ status: "unknown-session" });
  });

  it("is not replayable when no request was traced, giving the turns' reasons", async () => {
    const provider = copilotProvider(FOUR_SONNET, {
      requests: [],
      notTraced: [0, 1, 2, 3].map((turnIndex) => ({
        turnIndex,
        reason: "The turn has no usage.",
      })),
    });
    const result = await serviceOf([provider]).replay({
      sessionId: "s-1",
      model: "gpt-6.1-sol",
    });
    expect(result.status).toBe("not-replayable");
    expect(result.status === "not-replayable" && result.reason).toContain(
      "The turn has no usage.",
    );
  });

  it(`refuses a trace over ${MAX_REPLAY_REQUESTS} requests rather than simulating it (threat-model.md §4)`, async () => {
    const models = Array.from(
      { length: MAX_REPLAY_REQUESTS + 1 },
      () => SONNET,
    );
    const provider = new TraceProvider(
      "vscode",
      [copilotSession([SONNET])],
      [traceOf("vscode", "vscode-local", models)],
    );
    const result = await serviceOf([provider]).replay({
      sessionId: "s-1",
      model: "gpt-6.1-sol",
    });
    expect(result.status).toBe("not-replayable");
    expect(result.status === "not-replayable" && result.reason).toContain(
      MAX_REPLAY_REQUESTS.toLocaleString("en-US"),
    );
  });

  it("is an unknown model, with the resolver's reason, when no profile lists the target", async () => {
    const result = await serviceOf([copilotProvider(FOUR_SONNET)]).replay({
      sessionId: "s-1",
      model: "mystery-model",
    });
    expect(result).toEqual({
      status: "unknown-model",
      reason: expect.stringContaining("mystery-model"),
    });
  });

  it("is not replayable, with the simulator's message, when the simulation fails", async () => {
    const service = serviceOf([copilotProvider(FOUR_SONNET)], {
      simulate: () => {
        throw new Error("the simulator gave up");
      },
    });
    await expect(
      service.replay({ sessionId: "s-1", model: "gpt-6.1-sol" }),
    ).resolves.toEqual({
      status: "not-replayable",
      reason: "the simulator gave up",
    });
  });

  it("reads the named provider, not the active one", async () => {
    const service = serviceOf([
      copilotProvider(FOUR_SONNET),
      claudeCodeProvider(FOUR_SONNET),
    ]);
    const result = await service.replay({
      sessionId: "s-1",
      providerId: "claude-code",
      model: SONNET,
    });
    expect(result.status === "ok" && result.value.providerId).toBe(
      "claude-code",
    );
  });
});

describe("SessionReplayService.replay: a Copilot session on another model", () => {
  it("replays every turn on the target, priced on Copilot in AI Credits beside the billed figures (D2)", async () => {
    const prices = new FakePrices();
    const result = await serviceOf(
      [copilotProvider(FOUR_SONNET)],
      {},
      prices,
    ).replay({ sessionId: "s-1", model: "GPT-6.1-Sol" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const replay = sessionReplaySchema.parse(result.value);

    expect(replay).toMatchObject({
      simulated: true,
      sessionId: "s-1",
      providerId: "vscode",
      harness: "vscode-local",
      measuredModels: [SONNET],
      model: "gpt-6.1-sol",
      vendorId: "openai",
      pricing: {
        channel: "copilot",
        asOf: "2026-10-10",
        requested: "session-channel",
      },
      currency: "AI_CREDITS",
    });
    expect(replay.turns.map((turn) => turn.measured)).toEqual(
      [0, 1, 2, 3].map((i) => ({
        cacheRead: i * 100,
        cost: {
          known: true,
          value: 2,
          currency: "AI_CREDITS",
          basis: "billed",
        },
      })),
    );
    expect(
      replay.turns.every((turn) => turn.simulated?.cost.known === true),
    ).toBe(true);
    expect(replay.totals).toEqual({
      measured: { value: 8, knownTurns: 4, turns: 4 },
      simulated: { value: 4, knownTurns: 4, turns: 4 },
      difference: -4,
    });
    expect(replay.coverage).toEqual({
      turns: 4,
      replayedTurns: 4,
      requests: 4,
      replayedRequests: 4,
      notReplayed: [],
    });

    // Each simulated request is priced on the target model, as of its own time, for the session's provider.
    expect(
      prices.requests.map((r) => [r.usage.model, r.channel, r.turnStartedAt]),
    ).toEqual(
      [0, 1, 2, 3].map((i) => [
        "gpt-6.1-sol",
        { known: true, channel: CHANNEL.githubCopilot },
        request(i, SONNET).startedAt,
      ]),
    );
    expect(prices.requests[0]!.uncachedIncludesUnknownCacheWrite).toBe(true);
  });

  it("drops the session's own model switches: the whole session runs on the target (A1, A5)", async () => {
    const calls: SimulateOptions[] = [];
    const service = serviceOf(
      [copilotProvider([SONNET, "claude-haiku-5.5", SONNET, SONNET])],
      {
        simulate: (script, options) => {
          calls.push(options);
          if (calls.length === 1)
            expect(
              script.steps
                .flatMap((step) => step.events)
                .some((event) => event.type === "model-switch"),
            ).toBe(false);
          return simulateScenario(script, options);
        },
      },
    );
    const result = await service.replay({
      sessionId: "s-1",
      model: "gpt-6.1-sol",
    });
    expect(result.status === "ok" && result.value.measuredModels).toEqual([
      SONNET,
      "claude-haiku-5.5",
    ]);
    expect(calls[0]).toEqual({
      profile: expect.objectContaining({ vendorId: "openai" }),
      modelId: "gpt-6.1-sol",
      harness: "vscode-local",
    });
  });

  it("keeps the turns that weren't traced, with their reasons, in the coverage", async () => {
    const models = [SONNET, SONNET, SONNET];
    const provider = new TraceProvider(
      "vscode",
      [copilotSession([...models, SONNET])],
      [
        {
          ...traceOf("vscode", "vscode-local", models),
          notTraced: [{ turnIndex: 3, reason: "Not in the debug log." }],
        },
      ],
    );
    const result = await serviceOf([provider]).replay({
      sessionId: "s-1",
      model: SONNET,
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.value.coverage).toMatchObject({
      turns: 4,
      replayedTurns: 3,
      notReplayed: [{ reason: "Not in the debug log.", turns: 1 }],
    });
    expect(result.value.turns[3]).toMatchObject({
      simulated: null,
      notReplayedReason: "Not in the debug log.",
    });
  });
});

describe("SessionReplayService.replay: pricing and currency", () => {
  it("prices a Claude Code session replayed on GPT at OpenAI's API price, in USD", async () => {
    const prices = new FakePrices();
    const result = await serviceOf(
      [claudeCodeProvider(FOUR_SONNET)],
      {},
      prices,
    ).replay({ sessionId: "s-1", model: "gpt-6.1-sol" });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.value).toMatchObject({
      currency: "USD",
      pricing: { channel: "api", requested: "session-channel" },
    });
    expect(result.value.turns[0]!.measured.cost).toEqual({
      known: true,
      value: 0.5,
      currency: "USD",
      basis: "priced",
    });
    expect(prices.requests[0]).toMatchObject({
      channel: { known: true, channel: CHANNEL.openaiApi },
      defaultCacheWriteLifetime: "extended",
    });
  });

  it("converts the measured figures into the replay's currency at 1 AI Credit = $0.01 when asked for Copilot prices", async () => {
    const result = await serviceOf([claudeCodeProvider(FOUR_SONNET)]).replay({
      sessionId: "s-1",
      model: SONNET,
      pricing: "copilot",
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.value).toMatchObject({
      currency: "AI_CREDITS",
      pricing: { channel: "copilot", requested: "copilot" },
    });
    expect(result.value.turns[0]!.measured.cost).toEqual({
      known: true,
      value: 50,
      currency: "AI_CREDITS",
      basis: "priced",
    });
    expect(result.value.totals.measured.value).toBeCloseTo(200, 10);
  });

  it("converts billed AI Credits to USD when asked for API prices", async () => {
    const result = await serviceOf([copilotProvider(FOUR_SONNET)]).replay({
      sessionId: "s-1",
      model: SONNET,
      pricing: "api",
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.value).toMatchObject({
      currency: "USD",
      pricing: { channel: "api", requested: "api" },
    });
    expect(result.value.turns[0]!.measured.cost).toEqual({
      known: true,
      value: 0.02,
      currency: "USD",
      basis: "billed",
    });
  });

  it("still replays when the session's channel is unknown: every simulated cost is unknown with the reason", async () => {
    const provider = new TraceProvider(
      "pi-like",
      [
        sessionOf(
          "pi-like",
          FOUR_SONNET.map((m, i) => turnOf(i, m, unavailableTokenCount("n/a"))),
        ),
      ],
      [traceOf("pi-like", "claude-code", FOUR_SONNET)],
    );
    const result = await serviceOf([provider]).replay({
      sessionId: "s-1",
      model: SONNET,
    });
    if (result.status !== "ok") throw new Error(result.status);
    const replay = sessionReplaySchema.parse(result.value);
    expect(replay.coverage.replayedTurns).toBe(4);
    expect(replay.turns.map((turn) => turn.simulated?.cost)).toEqual(
      FOUR_SONNET.map(() => ({
        known: false,
        reason: "No channel for pi-like.",
      })),
    );
    expect(replay.totals.simulated.value).toBeNull();
    expect(replay.totals.difference).toBeNull();
    // No channel is made up: null with the reason. Nothing measured is
    // known either, so the currency falls back to USD.
    expect(replay).toMatchObject({ currency: "USD" });
    expect(replay.pricing).toEqual({
      channel: null,
      reason: `No price channel is known, so nothing simulated is priced: No channel for pi-like.`,
      asOf: "2026-10-10",
      requested: "session-channel",
    });
  });

  it("shows the measured figures in their own currency when no price channel is known", async () => {
    const provider = new TraceProvider(
      "pi-like",
      [
        sessionOf(
          "pi-like",
          FOUR_SONNET.map((m, i) => turnOf(i, m, k(2))),
        ),
      ],
      [traceOf("pi-like", "claude-code", FOUR_SONNET)],
    );
    const result = await serviceOf([provider]).replay({
      sessionId: "s-1",
      model: SONNET,
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.value.currency).toBe("AI_CREDITS");
    expect(result.value.pricing.channel).toBeNull();
    expect(result.value.turns[0]!.measured.cost).toEqual({
      known: true,
      value: 2,
      currency: "AI_CREDITS",
      basis: "billed",
    });
  });

  it("records no channel when the API price is asked for and the vendor lists no API channel", async () => {
    // Every real profile's vendor has an API channel, so a copy under a
    // vendor id with none stands in for one that doesn't.
    const anthropic = profiles.find((p) => p.vendorId === "anthropic")!;
    const acme = {
      ...anthropic,
      vendorId: "acme",
      models: anthropic.models.map((m) => ({
        ...m,
        vendorId: "acme",
        modelId: `acme-${m.modelId}`,
        ...(m.cheaperSiblingId
          ? { cheaperSiblingId: `acme-${m.cheaperSiblingId}` }
          : {}),
      })),
    };
    expect(vendorApiChannel("acme")).toBeUndefined();
    const service = serviceOf([copilotProvider(FOUR_SONNET)], {
      profiles: [...profiles, acme],
    });
    const result = await service.replay({
      sessionId: "s-1",
      model: `acme-${SONNET}`,
      pricing: "api",
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(sessionReplaySchema.parse(result.value).pricing).toMatchObject({
      channel: null,
      requested: "api",
      reason: expect.stringContaining("No API channel is listed"),
    });
    // The Copilot session's billed AI Credits stay in their own unit.
    expect(result.value.currency).toBe("AI_CREDITS");
  });

  it("keeps a measured cost that isn't known as unknown, with its reason", async () => {
    const service = serviceOf([copilotProvider(FOUR_SONNET)], { costs: {} });
    const result = await service.replay({ sessionId: "s-1", model: SONNET });
    if (result.status !== "ok") throw new Error(result.status);
    // Billed still comes from the log without a price book; with no
    // attribution the session's channel is unknown.
    expect(result.value.turns[0]!.measured.cost).toMatchObject({
      known: true,
      basis: "billed",
    });
    const unbilled = new TraceProvider(
      "vscode",
      [claudeCodeSession(FOUR_SONNET)],
      [traceOf("vscode", "vscode-local", FOUR_SONNET)],
    );
    const none = await serviceOf([unbilled], { costs: {} }).replay({
      sessionId: "s-1",
      model: SONNET,
    });
    if (none.status !== "ok") throw new Error(none.status);
    expect(none.value.turns[0]!.measured.cost).toEqual({
      known: false,
      reason: expect.stringContaining("No cost is known for this turn"),
    });
    expect(none.value.totals.measured).toEqual({
      value: null,
      knownTurns: 0,
      turns: 4,
    });
  });

  it("leaves a request's simulated cost unknown when the book has no price for the target", async () => {
    const result = await serviceOf(
      [copilotProvider(FOUR_SONNET)],
      {},
      new FakePrices(["gpt-6.1-sol"]),
    ).replay({ sessionId: "s-1", model: "gpt-6.1-sol" });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.value.turns[0]!.simulated?.cost).toEqual({
      known: false,
      reason: "No price for gpt-6.1-sol.",
    });
    expect(result.value.totals.simulated.value).toBeNull();
  });
});

describe("SessionReplayService.replay: self-check (G4, D8)", () => {
  it("checks a clean trace on its own model and passes", async () => {
    const result = await serviceOf([copilotProvider(FOUR_SONNET)]).replay({
      sessionId: "s-1",
      model: "gpt-6.1-sol",
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.value.selfCheck).toEqual({
      model: SONNET,
      requests: 3,
      matching: 3,
      readTolerancePercent: 5,
      passed: true,
    });
  });

  it("is null when the session's own model has no vendor profile", async () => {
    const result = await serviceOf([
      copilotProvider(["mystery-model", "mystery-model"]),
    ]).replay({ sessionId: "s-1", model: SONNET });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.value.selfCheck).toBeNull();
    expect(result.value.measuredModels).toEqual(["mystery-model"]);
  });

  it("runs a session that switched model on the models it really used", async () => {
    const calls: SimulateOptions[] = [];
    const service = serviceOf(
      [copilotProvider([SONNET, SONNET, "claude-opus-5.5", SONNET])],
      {
        simulate: (script, options) => {
          calls.push(options);
          return simulateScenario(script, options);
        },
      },
    );
    const result = await service.replay({
      sessionId: "s-1",
      model: "gpt-6.1-sol",
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(calls[1]).toMatchObject({
      modelId: SONNET,
      cheaperModelId: "claude-opus-5.5",
      harness: "vscode-local",
    });
    expect(result.value.selfCheck).toMatchObject({
      model: SONNET,
      requests: 3,
    });
  });

  it.each([
    ["the second model has no profile", [SONNET, "mystery-model", SONNET]],
    ["the second model is another vendor's", [SONNET, "gpt-6.1-sol", SONNET]],
    [
      "the session used three models",
      [SONNET, "claude-opus-5.5", "claude-haiku-5.5"],
    ],
  ])("is null when %s", async (_name, models) => {
    const result = await serviceOf([copilotProvider(models)]).replay({
      sessionId: "s-1",
      model: SONNET,
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.value.selfCheck).toBeNull();
  });

  it("is null, but the replay still stands, when the self-check's simulation fails", async () => {
    let calls = 0;
    const service = serviceOf([copilotProvider(FOUR_SONNET)], {
      simulate: (script, options) => {
        calls += 1;
        if (calls === 2) throw new Error("no");
        return simulateScenario(script, options);
      },
    });
    const result = await service.replay({
      sessionId: "s-1",
      model: "gpt-6.1-sol",
    });
    expect(result.status === "ok" && result.value.selfCheck).toBeNull();
  });
});

describe("SessionReplayService.replay: assumptions (plan §6)", () => {
  it("states A1, A2, A3 and A5 when the log records every cache write", async () => {
    const result = await serviceOf([copilotProvider(FOUR_SONNET)]).replay({
      sessionId: "s-1",
      model: "gpt-6.1-sol",
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.value.assumptions.map((a) => a.id)).toEqual([
      "A1",
      "A2",
      "A3",
      "A5",
    ]);
    expect(result.value.assumptions[0]).toEqual(REPLAY_ASSUMPTIONS.A1);
  });

  it("adds A4 when some request's cache writes weren't recorded", async () => {
    const trace = traceOf("vscode", "vscode-local", FOUR_SONNET);
    trace.requests[1] = {
      ...trace.requests[1]!,
      uncachedInput: trace.requests[1]!.cacheWrite!,
      cacheWrite: null,
    };
    const provider = new TraceProvider(
      "vscode",
      [copilotSession(FOUR_SONNET)],
      [trace],
    );
    const result = await serviceOf([provider]).replay({
      sessionId: "s-1",
      model: "gpt-6.1-sol",
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.value.assumptions.map((a) => a.id)).toEqual([
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
    ]);
  });

  it("words each assumption for a person, with an honest confidence: A1 is the main caveat", () => {
    for (const assumption of Object.values(REPLAY_ASSUMPTIONS)) {
      expect(assumption.text.length).toBeGreaterThan(40);
    }
    expect(REPLAY_ASSUMPTIONS.A1.confidence).toBe("unknown");
  });
});

describe("SessionReplayService.compare (D4)", () => {
  it("gives the session's total on its own model first and on each model asked for, deduplicated", async () => {
    const result = await serviceOf([copilotProvider(FOUR_SONNET)]).compare({
      sessionId: "s-1",
      models: ["gpt-6.1-sol", "GPT-6.1-SOL", "claude-haiku-5.5"],
    });
    if (result.status !== "ok") throw new Error(result.status);
    const comparison = sessionReplayComparisonSchema.parse(result.value);
    expect(comparison).toMatchObject({
      simulated: true,
      sessionId: "s-1",
      providerId: "vscode",
      currency: "AI_CREDITS",
      measured: { value: 8, knownTurns: 4, turns: 4 },
    });
    expect(comparison.entries).toEqual([
      {
        model: SONNET,
        vendorId: "anthropic",
        total: { value: 4, knownTurns: 4, turns: 4 },
        replayedTurns: 4,
        isMeasuredModel: true,
      },
      {
        model: "gpt-6.1-sol",
        vendorId: "openai",
        total: { value: 4, knownTurns: 4, turns: 4 },
        replayedTurns: 4,
        isMeasuredModel: false,
      },
      {
        model: "claude-haiku-5.5",
        vendorId: "anthropic",
        total: { value: 4, knownTurns: 4, turns: 4 },
        replayedTurns: 4,
        isMeasuredModel: false,
      },
    ]);
  });

  it("marks the session's own model when it is asked for too, without listing it twice", async () => {
    const result = await serviceOf([copilotProvider(FOUR_SONNET)]).compare({
      sessionId: "s-1",
      models: ["gpt-6.1-sol", SONNET],
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(
      result.value.entries.map((e) => [e.model, e.isMeasuredModel]),
    ).toEqual([
      [SONNET, true],
      ["gpt-6.1-sol", false],
    ]);
  });

  it("refuses the whole comparison when a model asked for has no profile", async () => {
    const result = await serviceOf([copilotProvider(FOUR_SONNET)]).compare({
      sessionId: "s-1",
      models: ["gpt-6.1-sol", "mystery-model"],
    });
    expect(result).toEqual({
      status: "unknown-model",
      reason: expect.stringContaining("mystery-model"),
    });
  });

  it("leaves out the session's own model when it has no profile, and refuses when nothing is left", async () => {
    const service = serviceOf([
      copilotProvider(["mystery-model", "mystery-model"]),
    ]);
    const result = await service.compare({
      sessionId: "s-1",
      models: ["gpt-6.1-sol"],
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(
      result.value.entries.map((e) => [e.model, e.isMeasuredModel]),
    ).toEqual([["gpt-6.1-sol", false]]);
    // The measured total comes from the first entry's replay then.
    expect(result.value.measured).toEqual({
      value: 4,
      knownTurns: 2,
      turns: 2,
    });
    expect(
      (await service.compare({ sessionId: "s-1", models: [] })).status,
    ).toBe("unknown-model");
  });

  it(`refuses more than ${MAX_COMPARED_MODELS} models, the session's own included (threat-model.md §4)`, async () => {
    const service = serviceOf([copilotProvider(FOUR_SONNET)]);
    const resolver = new ReplayModelResolver(profiles);
    const others = profiles
      .flatMap((p) => p.models.map((m) => m.modelId))
      .filter((id) => id !== SONNET && resolver.resolve(id).known);
    expect(others.length).toBeGreaterThanOrEqual(MAX_COMPARED_MODELS);
    await expect(
      service.compare({
        sessionId: "s-1",
        models: others.slice(0, MAX_COMPARED_MODELS - 1),
      }),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      service.compare({
        sessionId: "s-1",
        models: others.slice(0, MAX_COMPARED_MODELS),
      }),
    ).rejects.toThrow(TooManyComparedModelsError);
  });

  it("passes the session's refusals through", async () => {
    const service = serviceOf([copilotProvider(FOUR_SONNET)]);
    await expect(
      service.compare({ sessionId: "nope", models: ["gpt-6.1-sol"] }),
    ).resolves.toEqual({ status: "unknown-session" });
  });
});
