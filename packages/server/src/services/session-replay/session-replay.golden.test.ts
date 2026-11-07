import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  emptyProjectsFile,
  sessionReplayComparisonSchema,
  sessionReplaySchema,
  type RequestTrace,
  type Session,
  type SessionReplay,
  type Turn,
} from "@agent-cost-analyzer/domain";
import { AgentHostSessionSource } from "../../data-sources/agent-host/agent-host-session-source.js";
import { ClaudeCodeLogProvider } from "../../data-sources/claude-code/claude-code-log-provider.js";
import { computeClaudeCodeFileHash } from "../../data-sources/claude-code/session-id.js";
import type {
  LogProvider,
  RequestTraceReader,
} from "../../data-sources/log-providers/log-provider.js";
import { VscodeLogProvider } from "../../data-sources/log-providers/vscode/vscode-log-provider.js";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { createTurnPricer } from "../../composition/create-turn-pricer.js";
import {
  COPILOT_CLI_FIXTURE_HOME,
  COPILOT_CLI_FIXTURE_SESSION_IDS,
  writeCopilotCliAgentHostStores,
} from "../../test-support/copilot-cli-fixtures.js";
import {
  seedCopilotSessionStore,
  USAGE_SESSION_ID,
  writeUsageDebugLog,
} from "../../test-support/copilot-session-store.js";
import { FakeProvider } from "../../test-support/audit-fakes.js";
import { InMemoryFileSystem } from "../../test-support/in-memory-file-system.js";
import { RepositoryResolver } from "../cost-attribution/repository-resolver.js";
import { SessionAttributor } from "../cost-attribution/session-attributor.js";
import { ProfileVendorResolver } from "../cost-attribution/vendor-resolver.js";
import {
  calibrationCaptureSchema,
  type CalibrationCapture,
} from "../learn-simulation/calibration/capture.js";
import { traceFromCapture } from "../learn-simulation/calibration/replay.js";
import { simulateScenario } from "../learn-simulation/simulate-scenario.js";
import { BundledPriceBookSource } from "../pricing/bundled-price-book-source.js";
import { CostPricer } from "../pricing/cost-pricer.js";
import { PriceBook } from "../pricing/price-book.js";
import { CandidatePriceModelMapper } from "../pricing/price-model-mapper.js";
import type { ProviderLookup } from "../tool-audit/audit-query-service.js";
import { selfCheckMismatches } from "./replay-self-check.js";
import {
  SessionReplayService,
  type ScenarioSimulator,
} from "./session-replay-service.js";

// Phase 14 step 14.4 exit criterion (docs/plans/analyze-session-replay.md
// §12): golden replays of the providers' request-trace fixtures, each on its
// own model and on two others, over the real vendor profiles, the bundled
// price book, the real attribution and turn pricing. Each replay is
// committed as JSON under __golden__/ (update with `vitest -u` after
// checking the diff by hand, as cost-analysis.golden.test.ts). And the
// self-check through the service passes at D12 on every calibration capture
// except the two known disagreements.

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../../fixtures");
const profiles = loadVendorProfiles(path.join(fixtures, "vendor-profiles"));
// Pricing is as of each request's time; "now" only matters for "today"
// pricing, pinned anyway so nothing here depends on the clock.
const NOW = new Date("2026-11-07T12:00:00.000Z");

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const golden = (name: string) => `./__golden__/${name}.json`;

function lookupOf(provider: LogProvider): ProviderLookup {
  return { getActiveProvider: () => provider, getProvider: () => provider };
}

function serviceOver(
  provider: LogProvider,
  simulate?: ScenarioSimulator,
): SessionReplayService {
  const book = new PriceBook(new BundledPriceBookSource());
  return new SessionReplayService({
    providers: lookupOf(provider),
    profiles,
    prices: {
      snapshot: () => {
        const prices = book.snapshot();
        return new CostPricer({
          prices,
          models: new CandidatePriceModelMapper(prices),
          now: () => NOW,
        });
      },
    },
    costs: {
      // No repository on disk and no projects file: the channel is the
      // provider's own, and no contract price applies.
      attribution: new SessionAttributor({
        repositories: new RepositoryResolver(new InMemoryFileSystem({})),
        projects: { load: () => ({ file: emptyProjectsFile() }) },
        vendors: new ProfileVendorResolver(profiles),
        homeDir: "/home/dev",
      }),
      pricer: createTurnPricer(book, () => NOW),
    },
    ...(simulate ? { simulate } : {}),
  });
}

// The fixtures are dated before the price book's first prices
// (2026-10-01), so replayed as they are, every cost would be unknown. Each
// real provider is wrapped, in this test only, to move every time in its
// Session (startedAt, each turn's startedAt) and its RequestTrace (each
// request's startedAt) by one fixed offset, so the first request lands on
// SHIFTED_START: after every replayed model's first price (Claude Haiku 5.5
// from 2026-10-07) and clear of GPT-6.1 Sol's 2026-10-20 price change. The
// offset comes from the fixture's own first request, so it's deterministic;
// gaps and order are unchanged, so cache behaviour is identical.
const SHIFTED_START = "2026-10-21T09:00:00.000Z";
type TraceProvider = LogProvider & RequestTraceReader;

const shift = (time: string, offsetMs: number) =>
  new Date(Date.parse(time) + offsetMs).toISOString();

function timeShifted(
  provider: TraceProvider,
  start = SHIFTED_START,
): TraceProvider {
  const offsetOf = (trace: RequestTrace | null): number => {
    const first = trace?.requests[0];
    return first ? Date.parse(start) - Date.parse(first.startedAt) : 0;
  };
  const shiftTrace = (trace: RequestTrace, offset: number): RequestTrace => ({
    ...trace,
    requests: trace.requests.map((request) => ({
      ...request,
      startedAt: shift(request.startedAt, offset),
    })),
  });
  const shiftSession = (session: Session, offset: number): Session => ({
    ...session,
    ...(session.startedAt !== undefined
      ? { startedAt: shift(session.startedAt, offset) }
      : {}),
    turns: session.turns.map((turn) => ({
      ...turn,
      ...(turn.startedAt !== undefined
        ? { startedAt: shift(turn.startedAt, offset) }
        : {}),
    })),
  });
  return {
    id: provider.id,
    label: provider.label,
    checkAvailability: () => provider.checkAvailability(),
    listSessions: () => provider.listSessions(),
    readTurnDetail: (sessionId, turnIndex) =>
      provider.readTurnDetail(sessionId, turnIndex),
    readSession: async (sessionId) => {
      const session = await provider.readSession(sessionId);
      return (
        session &&
        shiftSession(
          session,
          offsetOf(await provider.readRequestTrace(sessionId)),
        )
      );
    },
    readRequestTrace: async (sessionId) => {
      const trace = await provider.readRequestTrace(sessionId);
      return trace && shiftTrace(trace, offsetOf(trace));
    },
  };
}

describe("timeShifted (test decorator)", () => {
  const trace: RequestTrace = {
    sessionId: "s",
    providerId: "p",
    harness: "claude-code",
    notTraced: [],
    requests: [0, 90_000].map((ms, index) => ({
      index,
      turnIndex: index,
      startedAt: new Date(
        Date.parse("2026-09-01T10:00:00.000Z") + ms,
      ).toISOString(),
      model: "m",
      uncachedInput: 1,
      cacheRead: 0,
      cacheWrite: 0,
      output: 1,
    })),
  };
  const session: Session = {
    id: "s",
    mode: "analyze",
    title: "s",
    model: "m",
    turns: [],
    turnCount: 0,
    costAiCredits: { known: false, reason: "n/a" },
    usageDataAvailable: true,
    startedAt: "2026-09-01T09:59:00.000Z",
  };
  class One extends FakeProvider implements RequestTraceReader {
    async readRequestTrace() {
      return trace;
    }
  }

  it("moves the first request to the start and every other time by the same offset", async () => {
    const shifted = timeShifted(new One("p", [session]));
    const moved = await shifted.readRequestTrace("s");
    expect(moved?.requests.map((r) => r.startedAt)).toEqual([
      SHIFTED_START,
      "2026-10-21T09:01:30.000Z",
    ]);
    expect((await shifted.readSession("s"))?.startedAt).toBe(
      "2026-10-21T08:59:00.000Z",
    );
    // The provider's own records are left as they were.
    expect(trace.requests[0]!.startedAt).toBe("2026-09-01T10:00:00.000Z");
  });
});

// Claude Code's session ids hash the file's path and time, so the golden
// names the fixture instead.
function stable(replay: SessionReplay, name: string): SessionReplay {
  return { ...replay, sessionId: name };
}

async function goldenReplays(
  service: SessionReplayService,
  sessionId: string,
  name: string,
  models: string[],
): Promise<SessionReplay[]> {
  const replays: SessionReplay[] = [];
  for (const model of models) {
    const result = await service.replay({ sessionId, model });
    if (result.status !== "ok")
      throw new Error(`${name} on ${model}: ${JSON.stringify(result)}`);
    const replay = sessionReplaySchema.parse(stable(result.value, name));
    expect(replay.simulated).toBe(true);
    expect(replay).toHaveProperty("selfCheck");
    replays.push(replay);
  }
  await expect(json(replays)).toMatchFileSnapshot(golden(name));
  return replays;
}

const CLAUDE_CODE_MODELS = [
  "claude-sonnet-5",
  "claude-haiku-5.5",
  "gpt-6.1-sol",
];
const COPILOT_MODELS = ["claude-sonnet-5", "claude-haiku-5.5", "gpt-6.1-sol"];

describe("golden replays: Claude Code fixtures", () => {
  const projectDir = path.join(fixtures, "claude-code", "-home-dev-project");
  const provider = new ClaudeCodeLogProvider({
    projectsDirPath: path.join(fixtures, "claude-code"),
  });
  const service = serviceOver(timeShifted(provider));
  const idOf = (name: string) =>
    computeClaudeCodeFileHash(path.join(projectDir, `${name}.jsonl`));

  for (const name of [
    "normal-session",
    "forked-session",
    "compacted-session",
    "tool-results-and-image-session",
    "meta-and-synthetic-session",
  ]) {
    it(`${name}: on its own model and two others`, async () => {
      const replays = await goldenReplays(
        service,
        idOf(name),
        `claude-code-${name}`,
        CLAUDE_CODE_MODELS,
      );
      expect(replays.map((r) => r.model)).toEqual(CLAUDE_CODE_MODELS);
    });
  }

  // Neither has a request with complete usage, so there is nothing to replay.
  it.each(["no-usage-session", "malformed-lines-session"])(
    "%s: nothing traced, so not replayable, with the reason",
    async (name) => {
      const result = await service.replay({
        sessionId: idOf(name),
        model: "gpt-6.1-sol",
      });
      expect(result).toEqual({
        status: "not-replayable",
        reason: expect.stringContaining(
          "No request of this session could be traced",
        ),
      });
    },
  );

  it("compares a session across models with the measured total", async () => {
    const result = await service.compare({
      sessionId: idOf("normal-session"),
      models: ["claude-haiku-5.5", "gpt-6.1-sol"],
    });
    if (result.status !== "ok") throw new Error(result.status);
    const comparison = sessionReplayComparisonSchema.parse({
      ...result.value,
      sessionId: "normal-session",
    });
    await expect(json(comparison)).toMatchFileSnapshot(
      golden("claude-code-normal-session-compare"),
    );
  });
});

describe("golden replays: Copilot fixtures", () => {
  let dir: string;
  let userDataDir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "session-replay-golden-"));
    userDataDir = mkdtempSync(path.join(tmpdir(), "session-replay-golden-ah-"));
    seedCopilotSessionStore(
      path.join(dir, "session-store.db"),
      "2026-08-08T10:00:00.000Z",
    );
    writeUsageDebugLog(path.join(dir, "debug-logs"));
    writeCopilotCliAgentHostStores(userDataDir);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("local harness (debug log, no agent-traces.db): on its own model and two others", async () => {
    const provider = new VscodeLogProvider({
      sessionStoreDbPath: path.join(dir, "session-store.db"),
      debugLogsDirPaths: [path.join(dir, "debug-logs")],
      agentTracesDbPath: null,
    });
    await goldenReplays(
      serviceOver(timeShifted(provider)),
      USAGE_SESSION_ID,
      "copilot-local-usage-session",
      COPILOT_MODELS,
    );
  });

  it("Agent Host (Copilot CLI event log): on its own model and two others", async () => {
    const provider = new VscodeLogProvider({
      sessionStoreDbPath: null,
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
      agentHostSessions: new AgentHostSessionSource({
        userDataDir,
        copilotHome: COPILOT_CLI_FIXTURE_HOME,
      }),
    });
    await goldenReplays(
      serviceOver(timeShifted(provider)),
      COPILOT_CLI_FIXTURE_SESSION_IDS.usageRecords,
      "copilot-agent-host-usage-records",
      COPILOT_MODELS,
    );
  });
});

// Phase 13.5a's calibration captures through the service: a provider that
// gives the capture as its trace (calibration's own traceFromCapture) and a
// session with one turn per request. The service runs with the harness's
// cache defaults on (plan §4.3), calibration with them off; every Claude
// Code capture records 1-hour writes from its first request, so the two
// agree here.
describe("self-check over every calibration capture (D12)", () => {
  // Copied from learn-simulation/calibration/calibration.test.ts's
  // KNOWN_DISAGREEMENTS (keep the two in step): every other capture passes.
  const KNOWN_DISAGREEMENTS: Record<string, number[]> = {
    "claude-code-39e87ae3": [14],
    "claude-code-2e4ad1d9": [20],
  };
  const dir = path.join(fixtures, "learn-calibration");
  const captures: CalibrationCapture[] = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) =>
      calibrationCaptureSchema.parse(
        JSON.parse(readFileSync(path.join(dir, file), "utf-8")),
      ),
    );

  function sessionOf(trace: RequestTrace): Session {
    const turns: Turn[] = trace.requests.map((request) => ({
      index: request.turnIndex,
      userMessage: "",
      assistantResponse: "",
      toolCalls: [],
      usage: {
        uncachedInput: { known: true, value: request.uncachedInput },
        cacheWrite: { known: true, value: request.cacheWrite ?? 0 },
        cacheRead: { known: true, value: request.cacheRead },
        tool: { known: false, reason: "n/a" },
        vision: { known: false, reason: "n/a" },
        reasoning: { known: false, reason: "n/a" },
        output: { known: true, value: request.output },
        costAiCredits: { known: false, reason: "n/a" },
        model: request.model,
      },
      explanation: "",
      startedAt: request.startedAt,
    }));
    return {
      id: trace.sessionId,
      mode: "analyze",
      title: trace.sessionId,
      model: trace.requests[0]!.model,
      turns,
      turnCount: turns.length,
      costAiCredits: { known: false, reason: "n/a" },
      usageDataAvailable: true,
    };
  }

  class CaptureProvider extends FakeProvider implements RequestTraceReader {
    constructor(private readonly trace: RequestTrace) {
      super(trace.providerId, [sessionOf(trace)]);
    }
    async readRequestTrace(sessionId: string): Promise<RequestTrace | null> {
      return sessionId === this.trace.sessionId ? this.trace : null;
    }
  }

  it("has the three clean captures and the two known disagreements", () => {
    expect(
      captures
        .map((capture) => capture.id)
        .filter((id) => !(id in KNOWN_DISAGREEMENTS)),
    ).toHaveLength(3);
  });

  for (const capture of captures) {
    it(`${capture.id}: the replay's self-check matches calibration`, async () => {
      const trace = traceFromCapture(capture);
      // The service's own self-check simulation (its second call: the first
      // is the replay on the target), kept to name the requests that differ.
      const simulations: Session[] = [];
      const service = serviceOver(
        new CaptureProvider(trace),
        (script, options) => {
          const session = simulateScenario(script, options);
          simulations.push(session);
          return session;
        },
      );
      const result = await service.replay({
        sessionId: capture.id,
        model: "gpt-6.1-sol",
      });
      if (result.status !== "ok") throw new Error(JSON.stringify(result));

      const expected = KNOWN_DISAGREEMENTS[capture.id] ?? [];
      expect(selfCheckMismatches(trace, simulations[1]!)).toEqual(expected);
      expect(result.value.selfCheck).toEqual({
        model: capture.modelId,
        requests: capture.requests.length - 1,
        matching: capture.requests.length - 1 - expected.length,
        readTolerancePercent: 5,
        passed: expected.length === 0,
      });
    });
  }
});
