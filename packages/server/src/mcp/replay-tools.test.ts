// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  MAX_COMPARED_MODELS,
  sessionReplayComparisonSchema,
  sessionReplaySchema,
  type LogProviderStatus,
  type SessionReplay,
  type SessionReplayComparison,
} from "@agent-cost-analyzer/domain";
import { AnalysisQueryService } from "../services/analysis/analysis-query-service.js";
import { InsightsService } from "../services/insights/insights-service.js";
import {
  REPLAY_ASSUMPTIONS,
  TooManyComparedModelsError,
  type CompareRequest,
  type ReplayRequest,
  type ReplayResult,
  type SessionReplayQueries,
} from "../services/session-replay/session-replay-service.js";
import { AuditQueryService } from "../services/tool-audit/audit-query-service.js";
import { FakeProvider, lookup } from "../test-support/audit-fakes.js";
import { createMcpServer } from "./mcp-server.js";

// Phase 14 step 14.5 (docs/plans/analyze-session-replay.md §9, D7):
// replay_session and compare_models_for_session, read-only, with the domain
// schemas as output schemas, over a fake SessionReplayQueries. A result the
// service can't give is a tool error with its reason, never a thrown stack.

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const textOf = (result: ToolResult): string => (result.content as { text: string }[])[0]!.text;

const providerStatus: LogProviderStatus = { activeProviderId: "fake", providers: [{ id: "fake", label: "Fake", available: true }] };

const replay: SessionReplay = {
  simulated: true,
  sessionId: "s-1",
  providerId: "claude-code",
  harness: "claude-code",
  measuredModels: ["claude-sonnet-5-5-20261001"],
  model: "claude-haiku-5.5",
  vendorId: "anthropic",
  pricing: { channel: "api", asOf: "2026-10-10", requested: "session-channel" },
  currency: "USD",
  turns: [
    {
      turnIndex: 0,
      measured: { cacheRead: 0, cost: { known: true, value: 0.02, currency: "USD", basis: "priced" } },
      simulated: { cacheRead: 0, cacheWrite: 2000, outcome: "miss", cost: { known: true, value: 0.01, currency: "USD" } },
    },
  ],
  totals: {
    measured: { value: 0.02, knownTurns: 1, turns: 1 },
    simulated: { value: 0.01, knownTurns: 1, turns: 1 },
    difference: -0.01,
  },
  coverage: { turns: 1, replayedTurns: 1, requests: 1, replayedRequests: 1, notReplayed: [] },
  selfCheck: { model: "claude-sonnet-5.5", requests: 0, matching: 0, readTolerancePercent: 5, passed: true },
  assumptions: [REPLAY_ASSUMPTIONS.A1],
};

const comparison: SessionReplayComparison = {
  simulated: true,
  sessionId: "s-1",
  providerId: "claude-code",
  currency: "USD",
  measured: { value: 0.02, knownTurns: 1, turns: 1 },
  entries: [
    { model: "claude-sonnet-5.5", vendorId: "anthropic", total: { value: 0.02, knownTurns: 1, turns: 1 }, replayedTurns: 1, isMeasuredModel: true },
    { model: "claude-haiku-5.5", vendorId: "anthropic", total: { value: 0.01, knownTurns: 1, turns: 1 }, replayedTurns: 1, isMeasuredModel: false },
  ],
};

class FakeReplays implements SessionReplayQueries {
  readonly replays: ReplayRequest[] = [];
  readonly compares: CompareRequest[] = [];
  constructor(
    private readonly replayResult: ReplayResult<SessionReplay> = { status: "ok", value: replay },
    private readonly compareResult: ReplayResult<SessionReplayComparison> | Error = { status: "ok", value: comparison },
  ) {}
  async replay(request: ReplayRequest) {
    this.replays.push(request);
    return this.replayResult;
  }
  async compare(request: CompareRequest) {
    this.compares.push(request);
    if (this.compareResult instanceof Error) throw this.compareResult;
    return this.compareResult;
  }
}

let client: Client | undefined;

async function connect(sessionReplay?: SessionReplayQueries): Promise<Client> {
  const provider = new FakeProvider("fake", []);
  const providers = lookup(provider);
  const server = createMcpServer({
    auditQueries: new AuditQueryService(providers),
    analysisQueries: new AnalysisQueryService(providers, new InsightsService({ listProviders: () => [provider] }, [])),
    getProviderStatus: async () => providerStatus,
    version: "0.0.0-test",
    ...(sessionReplay ? { sessionReplay } : {}),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe("MCP replay tools (Phase 14 step 14.5, D7)", () => {
  it("lists replay_session and compare_models_for_session read-only, with output schemas, saying the figures are Simulated and checked", async () => {
    const { tools } = await (await connect(new FakeReplays())).listTools();

    for (const name of ["replay_session", "compare_models_for_session"]) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.annotations, name).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(tool?.outputSchema?.type, name).toBe("object");
      expect(tool?.description, name).toMatch(/Simulated/);
      expect(tool?.description, name).toMatch(/same conversation/i);
    }
    const replayTool = tools.find((tool) => tool.name === "replay_session")!;
    expect(replayTool.description).toMatch(/self-check/i);
    expect(Object.keys(replayTool.inputSchema.properties ?? {}).sort()).toEqual(["model", "pricing", "provider", "sessionId"]);
    expect(replayTool.inputSchema.required?.sort()).toEqual(["model", "sessionId"]);
    const compareTool = tools.find((tool) => tool.name === "compare_models_for_session")!;
    expect(Object.keys(compareTool.inputSchema.properties ?? {}).sort()).toEqual(["models", "pricing", "provider", "sessionId"]);
  });

  it("registers neither tool without a replay service", async () => {
    const { tools } = await (await connect()).listTools();

    expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["replay_session"]));
    expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["compare_models_for_session"]));
  });

  it("replay_session returns the service's SessionReplay, passing the session, model, pricing and provider", async () => {
    const replays = new FakeReplays();
    const result = await (await connect(replays)).callTool({
      name: "replay_session",
      arguments: { sessionId: "s-1", model: "claude-haiku-5.5", pricing: "api", provider: "claude-code" },
    });

    expect(result.isError).not.toBe(true);
    expect(sessionReplaySchema.parse(result.structuredContent)).toEqual(replay);
    expect(replays.replays).toEqual([{ sessionId: "s-1", model: "claude-haiku-5.5", pricing: "api", providerId: "claude-code" }]);
  });

  it("compare_models_for_session returns the service's comparison", async () => {
    const replays = new FakeReplays();
    const result = await (await connect(replays)).callTool({
      name: "compare_models_for_session",
      arguments: { sessionId: "s-1", models: ["claude-haiku-5.5", "gpt-6.1-sol"] },
    });

    expect(result.isError).not.toBe(true);
    expect(sessionReplayComparisonSchema.parse(result.structuredContent)).toEqual(comparison);
    expect(replays.compares).toEqual([{ sessionId: "s-1", models: ["claude-haiku-5.5", "gpt-6.1-sol"] }]);
  });

  it.each([
    [{ status: "unknown-session" } as const, /Unknown session id "s-1".*list_sessions/],
    [{ status: "unknown-model", reason: 'No vendor profile lists the model "nope", so it can\'t be replayed.' } as const, /No vendor profile lists the model "nope"/],
    [{ status: "not-replayable", reason: "This provider's logs can't be replayed yet." } as const, /can't be replayed yet/],
  ])("answers a %o result with a tool error carrying the reason", async (failure, message) => {
    const c = await connect(new FakeReplays(failure, failure));

    for (const [name, extra] of [
      ["replay_session", { model: "claude-haiku-5.5" }],
      ["compare_models_for_session", { models: ["claude-haiku-5.5"] }],
    ] as const) {
      const result = await c.callTool({ name, arguments: { sessionId: "s-1", ...extra } });
      expect(result.isError, name).toBe(true);
      expect(textOf(result), name).toMatch(message);
      expect(textOf(result), name).not.toMatch(/\bat .*\.(ts|js):\d+/);
    }
  });

  it("answers too many models (the session's own included) with the service's reason", async () => {
    const result = await (await connect(new FakeReplays(undefined, new TooManyComparedModelsError(11)))).callTool({
      name: "compare_models_for_session",
      arguments: { sessionId: "s-1", models: ["a", "b"] },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/At most 10 models can be compared/);
  });

  it("refuses arguments over the limits before the service is asked (threat-model.md §4)", async () => {
    const replays = new FakeReplays();
    const c = await connect(replays);
    const tooMany = Array.from({ length: MAX_COMPARED_MODELS + 1 }, (_, i) => `model-${i}`);

    for (const [name, args] of [
      ["replay_session", { sessionId: "s-1", model: "x".repeat(101) }],
      ["replay_session", { sessionId: "s-1", model: "" }],
      ["replay_session", { sessionId: "s-1", model: "claude-haiku-5.5", pricing: "today" }],
      ["compare_models_for_session", { sessionId: "s-1", models: tooMany }],
      ["compare_models_for_session", { sessionId: "s-1", models: [] }],
    ] as const) {
      const result = await c.callTool({ name, arguments: args });
      expect(result.isError, `${name} ${JSON.stringify(args).slice(0, 60)}`).toBe(true);
    }
    expect(replays.replays).toEqual([]);
    expect(replays.compares).toEqual([]);
  });
});
