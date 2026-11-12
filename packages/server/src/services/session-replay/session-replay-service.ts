// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  MAX_COMPARED_MODELS,
  channelCurrency,
  preferredCostFigure,
  type CostFigure,
  type Currency,
  type MeasuredCost,
  type ReplayAssumption,
  type ReplayCoverage,
  type ReplayPricing,
  type ReplaySelfCheck,
  type RequestTrace,
  type ScenarioScript,
  type Session,
  type SessionReplay,
  type SessionReplayComparison,
  type SimulatedCost,
  type Turn,
  type VendorProfile,
  sumTokenCounts,
} from "@agent-cost-analyzer/domain";
import {
  canReadRequestTrace,
  type LogProvider,
} from "../../data-sources/log-providers/log-provider.js";
import type { SessionCostSources } from "../analysis/analysis-query-service.js";
import type { ChannelResolution } from "../cost-attribution/channel-resolver.js";
import {
  NOT_ATTRIBUTED,
  type RowAttributor,
} from "../insights/insights-dataset-builder.js";
import {
  simulateScenario,
  type SimulateOptions,
} from "../learn-simulation/simulate-scenario.js";
import {
  TurnCostFigureBuilder,
  type PricedFigureSource,
  type TurnPricer,
} from "../pricing/turn-cost-figures.js";
import type { ProviderLookup } from "../tool-audit/audit-query-service.js";
import { alignReplay, type SimulatedRequest } from "./replay-aligner.js";
import {
  ReplayModelResolver,
  type ReplayModelResolution,
} from "./replay-model-resolver.js";
import {
  ReplayPricer,
  convertCost,
  replayChannel,
  type ReplayChannelResolution,
} from "./replay-pricer.js";
import { withoutModelSwitches } from "./replay-script-variants.js";
import { replaySelfCheck } from "./replay-self-check.js";
import { scriptFromRequestTrace } from "./request-trace-scripter.js";

// Phase 14 step 14.4 (docs/plans/analyze-session-replay.md §4, §7, §8): a
// real session replayed on another model, and compared across models. It
// composes the request trace, the scripter, the Learn simulator, the replay
// pricer, the aligner and the self-check over narrow ports (DIP), adding no
// rule of its own. Measured figures are the session's own, as
// get_session_cost and the Dashboard show them (the same attribution and
// turn pricing); every unknown keeps its reason, never 0 (constraint 6).

export type ReplayPricingRequest = ReplayPricing["requested"];

export interface ReplayRequest {
  sessionId: string;
  // The active provider when left out.
  providerId?: string;
  // A vendor profile's model id (log spellings resolve too).
  model: string;
  // D2: the session's own channel by default.
  pricing?: ReplayPricingRequest;
}

export interface CompareRequest {
  sessionId: string;
  providerId?: string;
  models: string[];
  pricing?: ReplayPricingRequest;
}

export type ReplayResult<T> =
  | { status: "ok"; value: T }
  | { status: "unknown-session" }
  | { status: "not-replayable"; reason: string }
  | { status: "unknown-model"; reason: string };

export interface SessionReplayQueries {
  replay(request: ReplayRequest): Promise<ReplayResult<SessionReplay>>;
  compare(
    request: CompareRequest,
  ): Promise<ReplayResult<SessionReplayComparison>>;
}

// The price book as it is when a replay is priced (CostPricer over a
// snapshot), so a contract price edited meanwhile is picked up next time.
export interface ReplayPriceSource {
  snapshot(): PricedFigureSource;
}

export type ScenarioSimulator = (
  script: ScenarioScript,
  options: SimulateOptions,
) => Session;

export interface SessionReplayDeps {
  providers: ProviderLookup;
  profiles: readonly VendorProfile[];
  // What a simulated request would cost (ReplayPricer's CostPricer).
  prices: ReplayPriceSource;
  // The session's own attribution (its channel) and measured figures, the
  // same sources AnalysisQueryService uses (step 15.6).
  costs: SessionCostSources;
  // The Learn simulator; tests pass a fake.
  simulate?: ScenarioSimulator;
}

// D1: pi and mitmproxy don't read traces yet.
export const NOT_REPLAYABLE_PROVIDER_REASON =
  "This provider's logs can't be replayed yet.";

// threat-model.md §4: a longer trace is refused rather than simulated (the
// simulator is linear in requests). The longest real session checked in
// step 14.3 had 484 requests, far below it.
export const MAX_REPLAY_REQUESTS = 20_000;

// The cap on models in one comparison (MAX_COMPARED_MODELS, the session's
// own model included) is a validation error, as the route's 400 will be
// (step 14.5 checks its input first): it says nothing about the session.
export class TooManyComparedModelsError extends RangeError {
  constructor(count: number) {
    super(
      `At most ${MAX_COMPARED_MODELS} models can be compared, the session's own model included (${count} given)`,
    );
    this.name = "TooManyComparedModelsError";
  }
}

// Plan §6, worded for a person, each with how sure we are it holds.
export const REPLAY_ASSUMPTIONS = {
  A1: {
    id: "A1",
    text: "Same conversation: the other model is assumed to get the same prompts and to answer with as many output and reasoning tokens as the session's model did. It wouldn't: another model writes other answers and makes other tool calls, so this is the comparison's main caveat.",
    confidence: "unknown",
  },
  A2: {
    id: "A2",
    text: "Same token counts: the session's token counts are kept as they are. Another vendor's tokenizer would count the same text differently, but no text is read to count it again and no vendor publishes a conversion to apply.",
    confidence: "unknown",
  },
  A3: {
    id: "A3",
    text: "Cold start: the first request is assumed to read nothing from the cache, though other sessions may have left the tools and system prompt cached. The self-check leaves that request out for the same reason.",
    confidence: "inferred",
  },
  A4: {
    id: "A4",
    text: "Inferred cache writes: the log records no cache writes for some requests (Copilot's local harness without agent-traces.db), so those writes are what the vendor's caching rules say they would have been.",
    confidence: "inferred",
  },
  A5: {
    id: "A5",
    text: "Same harness: the session's agent is kept, with its tool definitions, cache breakpoints and cache lifetime defaults; only the model, its vendor's caching rules and its prices change.",
    confidence: "inferred",
  },
} as const satisfies Record<string, ReplayAssumption>;

const UNATTRIBUTED: RowAttributor = {
  session: () => NOT_ATTRIBUTED,
  turn: () => NOT_ATTRIBUTED,
};
// Without a price book, billed and reported still come from the log.
const UNPRICED: TurnPricer = new TurnCostFigureBuilder();

const NON_CONTIGUOUS_TURNS_REASON =
  "The session's turns aren't numbered 0, 1, 2…, so its trace can't be lined up with them.";

// One session read for one or more replays: its trace, script and own
// figures, and the sources priced against, read once.
interface Loaded {
  provider: LogProvider;
  session: Session;
  trace: RequestTrace;
  script: ScenarioScript;
  measuredModels: string[];
  sessionChannel: ChannelResolution;
  attributor: RowAttributor;
  turnPricer: TurnPricer;
  pricer: ReplayPricer;
  // Run once, on the first replay that needs it.
  selfCheck: () => ReplaySelfCheck | null;
  assumptions: ReplayAssumption[];
}

type KnownModel = Extract<ReplayModelResolution, { known: true }>;

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

function once<T>(compute: () => T): () => T {
  let value: { computed: T } | undefined;
  return () => (value ??= { computed: compute() }).computed;
}

function emptyTraceReason(trace: RequestTrace): string {
  const reasons = distinct(trace.notTraced.map((turn) => turn.reason));
  const base =
    "No request of this session could be traced, so there is nothing to replay";
  return reasons.length === 0 ? `${base}.` : `${base}: ${reasons.join(" ")}`;
}

const NO_CHANNEL_REASON = (reason: string): string =>
  `No price channel is known, so nothing simulated is priced: ${reason}`;

// The replay's currency: its price channel's unit. With no channel known,
// nothing simulated is priced, so the currency only labels the measured
// figures: the unit of the first known one, so they are shown as recorded
// (others converted at the one documented rate), else USD.
function currencyOf(
  channel: ReplayChannelResolution,
  measured: CostFigure[],
): Currency {
  if (channel.known) return channelCurrency(channel.channel);
  const first = measured.find((figure) => figure.known);
  return first?.known ? first.currency : "USD";
}

// A measured figure in the replay's currency.
function inCurrency(figure: CostFigure, currency: Currency): MeasuredCost {
  if (!figure.known) return { known: false, reason: figure.reason };
  const value = convertCost(figure.amount, figure.currency, currency);
  return value === undefined
    ? {
        known: false,
        reason: `The measured cost is in ${figure.currency}, which can't be shown in ${currency}.`,
      }
    : { known: true, value, currency, basis: figure.basis };
}

// D11: the trace is the main chain, so a turn that folds in subagent runs is
// compared on its own usage (the folded figures would include requests the
// replay leaves out).
function mainAgentTurn(turn: Turn): Turn {
  const { subagents, ownUsage, ...main } = turn.usage;
  if (subagents === undefined || ownUsage === undefined) return turn;
  // The log records no extended write or own cost for classic turns, so the
  // spread keeps nothing folded that the own figures should replace.
  return { ...turn, usage: { ...main, ...ownUsage } };
}

const RUN_COST_UNKNOWN_REASON =
  "At least one subagent run's AI Credits are unknown.";

// The runs the replay leaves out, for the coverage line.
function subagentRunsOutside(
  turns: Turn[],
): ReplayCoverage["subagentRuns"] {
  const runs = turns.flatMap((turn) => turn.usage.subagents ?? []);
  if (runs.length === 0) return undefined;
  return {
    runs: runs.length,
    costAiCredits: sumTokenCounts(
      runs.map((run) => run.costAiCredits),
      RUN_COST_UNKNOWN_REASON,
    ),
  };
}

function withSubagentRuns(
  coverage: ReplayCoverage,
  turns: Turn[],
): ReplayCoverage {
  const subagentRuns = subagentRunsOutside(turns);
  return subagentRuns === undefined ? coverage : { ...coverage, subagentRuns };
}

function assumptionsFor(trace: RequestTrace): ReplayAssumption[] {
  const { A1, A2, A3, A4, A5 } = REPLAY_ASSUMPTIONS;
  const inferredWrites = trace.requests.some((r) => r.cacheWrite === null);
  return [A1, A2, A3, ...(inferredWrites ? [A4] : []), A5];
}

export class SessionReplayService implements SessionReplayQueries {
  private readonly resolver: ReplayModelResolver;
  private readonly simulate: ScenarioSimulator;

  constructor(private readonly deps: SessionReplayDeps) {
    this.resolver = new ReplayModelResolver(deps.profiles);
    this.simulate = deps.simulate ?? simulateScenario;
  }

  async replay(request: ReplayRequest): Promise<ReplayResult<SessionReplay>> {
    const loaded = await this.load(request.sessionId, request.providerId);
    if (loaded.status !== "ok") return loaded;
    const target = this.resolver.resolve(request.model);
    if (!target.known)
      return { status: "unknown-model", reason: target.reason };
    return this.replayOn(
      loaded.value,
      target,
      request.pricing ?? "session-channel",
    );
  }

  async compare(
    request: CompareRequest,
  ): Promise<ReplayResult<SessionReplayComparison>> {
    // A cheap guard before any read: the list is capped either way.
    const asked = distinct(request.models);
    if (asked.length > MAX_COMPARED_MODELS) {
      throw new TooManyComparedModelsError(asked.length);
    }
    const loaded = await this.load(request.sessionId, request.providerId);
    if (loaded.status !== "ok") return loaded;
    const { value } = loaded;

    // A model asked for that no profile lists refuses the whole comparison
    // (the route's allow-list, threat-model.md §4): an entry has no field
    // for a reason, and leaving it out silently would hide it. The
    // session's own model is added first when it resolves; when it
    // doesn't, it is left out (its replay has no profile to run on).
    const targets: KnownModel[] = [];
    for (const model of asked) {
      const target = this.resolver.resolve(model);
      if (!target.known)
        return { status: "unknown-model", reason: target.reason };
      targets.push(target);
    }
    const own = this.resolver.resolve(value.measuredModels[0]!);
    const models = new Map<string, KnownModel>();
    for (const model of own.known ? [own, ...targets] : targets) {
      if (!models.has(model.modelId)) models.set(model.modelId, model);
    }
    if (models.size === 0) {
      return {
        status: "unknown-model",
        reason: own.known ? "No model was given to compare." : own.reason,
      };
    }
    if (models.size > MAX_COMPARED_MODELS) {
      throw new TooManyComparedModelsError(models.size);
    }

    const pricing = request.pricing ?? "session-channel";
    const replays: SessionReplay[] = [];
    for (const model of models.values()) {
      const replay = this.replayOn(value, model, pricing);
      if (replay.status !== "ok") return replay;
      replays.push(replay.value);
    }
    const ownModelId = own.known ? own.modelId : undefined;
    // Each replay's measured total is over its own paired turns (replayed
    // with a known simulated and a known measured cost), so the sets can
    // differ by model, e.g. where one model has no price. The comparison
    // shows the own-model replay's (the first entry's when the own model
    // has no profile): the session's real cost over the turns its own
    // model replays.
    const reference = replays[0]!;
    return {
      status: "ok",
      value: {
        simulated: true,
        sessionId: reference.sessionId,
        providerId: reference.providerId,
        currency: reference.currency,
        measured: reference.totals.measured,
        entries: replays.map((replay) => ({
          model: replay.model,
          vendorId: replay.vendorId,
          total: replay.totals.simulated,
          replayedTurns: replay.coverage.replayedTurns,
          isMeasuredModel: replay.model === ownModelId,
        })),
      },
    };
  }

  private async load(
    sessionId: string,
    providerId?: string,
  ): Promise<ReplayResult<Loaded>> {
    const { providers, costs, prices } = this.deps;
    const provider = providerId
      ? providers.getProvider(providerId)
      : providers.getActiveProvider();
    const session = await provider.readSession(sessionId);
    if (!session) return { status: "unknown-session" };
    if (!canReadRequestTrace(provider)) {
      return {
        status: "not-replayable",
        reason: NOT_REPLAYABLE_PROVIDER_REASON,
      };
    }
    const trace = await provider.readRequestTrace(sessionId);
    if (!trace) return { status: "unknown-session" };
    if (trace.requests.length === 0) {
      return { status: "not-replayable", reason: emptyTraceReason(trace) };
    }
    if (trace.requests.length > MAX_REPLAY_REQUESTS) {
      return {
        status: "not-replayable",
        reason: `This session has ${trace.requests.length.toLocaleString("en-US")} requests; at most ${MAX_REPLAY_REQUESTS.toLocaleString("en-US")} can be replayed.`,
      };
    }
    if (session.turns.some((turn, position) => turn.index !== position)) {
      return { status: "not-replayable", reason: NON_CONTIGUOUS_TURNS_REASON };
    }

    const script = scriptFromRequestTrace(trace);
    const measuredModels = distinct(trace.requests.map((r) => r.model));
    const attributor = costs.attribution?.snapshot() ?? UNATTRIBUTED;
    return {
      status: "ok",
      value: {
        provider,
        session,
        trace,
        script,
        measuredModels,
        // The session's channel as its Dashboard row has it.
        sessionChannel: attributor.session(provider.id, session).channel,
        attributor,
        turnPricer: costs.pricer?.snapshot() ?? UNPRICED,
        pricer: new ReplayPricer(prices.snapshot()),
        selfCheck: once(() => this.selfCheck(trace, script, measuredModels)),
        assumptions: assumptionsFor(trace),
      },
    };
  }

  private replayOn(
    loaded: Loaded,
    target: KnownModel,
    requested: ReplayPricingRequest,
  ): ReplayResult<SessionReplay> {
    const { provider, session, trace } = loaded;
    // A1/A5: the whole session runs on the target, so its switches go.
    let simulated: Session;
    try {
      simulated = this.simulate(withoutModelSwitches(loaded.script), {
        profile: target.profile,
        modelId: target.modelId,
        harness: trace.harness,
      });
    } catch (error) {
      return {
        status: "not-replayable",
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    const channel = replayChannel(
      requested,
      loaded.sessionChannel,
      target.vendorId,
    );
    const mainTurns = session.turns.map(mainAgentTurn);
    const figures = mainTurns.map((turn) => this.measuredFigure(loaded, turn));
    const currency = currencyOf(channel, figures);

    const simulatedRequests = simulated.turns.map(
      (turn, position): SimulatedRequest =>
        this.simulatedRequest(loaded, turn, channel, position),
    );
    const measured = mainTurns.map((turn, position) => ({
      cacheRead: turn.usage.cacheRead.known ? turn.usage.cacheRead.value : null,
      cost: inCurrency(figures[position]!, currency),
    }));
    const aligned = alignReplay({
      trace,
      turnCount: session.turns.length,
      measured,
      simulated: simulatedRequests,
      currency,
    });

    return {
      status: "ok",
      value: {
        simulated: true,
        sessionId: session.id,
        providerId: provider.id,
        harness: trace.harness,
        measuredModels: loaded.measuredModels,
        model: target.modelId,
        vendorId: target.vendorId,
        pricing: {
          ...(channel.known
            ? { channel: channel.kind }
            : { channel: null, reason: NO_CHANNEL_REASON(channel.reason) }),
          asOf: trace.requests[0]!.startedAt.slice(0, 10),
          requested,
        },
        currency,
        ...aligned,
        coverage: withSubagentRuns(aligned.coverage, session.turns),
        selfCheck: loaded.selfCheck(),
        assumptions: loaded.assumptions,
      },
    };
  }

  private simulatedRequest(
    loaded: Loaded,
    turn: Turn,
    channel: ReplayChannelResolution,
    position: number,
  ): SimulatedRequest {
    const { cacheRead, cacheWrite } = turn.usage;
    if (!cacheRead.known) return { unknown: cacheRead.reason };
    if (!cacheWrite.known) return { unknown: cacheWrite.reason };
    const cost: SimulatedCost = channel.known
      ? loaded.pricer.price({
          usage: turn.usage,
          channel: channel.channel,
          at: loaded.trace.requests[position]!.startedAt,
          providerId: loaded.provider.id,
        })
      : { known: false, reason: channel.reason };
    return {
      cacheRead: cacheRead.value,
      cacheWrite: cacheWrite.value,
      outcome: turn.simulation?.cacheOutcome ?? "unknown",
      cost,
    };
  }

  // The turn's preferred figure (billed, else reported, else priced) as
  // get_session_cost has it.
  private measuredFigure(loaded: Loaded, turn: Turn): CostFigure {
    const { provider, session, attributor, turnPricer } = loaded;
    return preferredCostFigure(
      turnPricer.figuresFor(
        provider.id,
        session,
        turn,
        attributor.turn(provider.id, session, turn),
      ),
    );
  }

  // G4/D8: the unmodified script, switches included, on the session's own
  // model(s), compared with the trace. null when it can't be run honestly:
  // - the own model has no profile to simulate;
  // - the session switched to a model with no profile, or to another
  //   vendor's: the simulator runs both roles in one profile, and without
  //   cheaperModelId it would use the curated sibling, not the real model;
  // - the session used three or more models: the scripter maps every
  //   non-first model to the one "cheaper" role, so two of them would share
  //   a cache they never shared;
  // - the simulation itself fails (the replay still stands).
  private selfCheck(
    trace: RequestTrace,
    script: ScenarioScript,
    measuredModels: string[],
  ): ReplaySelfCheck | null {
    const own = this.resolver.resolve(measuredModels[0]!);
    if (!own.known || measuredModels.length > 2) return null;
    let cheaperModelId: string | undefined;
    if (measuredModels.length === 2) {
      const second = this.resolver.resolve(measuredModels[1]!);
      if (!second.known || second.vendorId !== own.vendorId) return null;
      cheaperModelId = second.modelId;
    }
    try {
      const simulated = this.simulate(script, {
        profile: own.profile,
        modelId: own.modelId,
        harness: trace.harness,
        ...(cheaperModelId !== undefined ? { cheaperModelId } : {}),
      });
      return replaySelfCheck(trace, simulated, own.modelId);
    } catch {
      return null;
    }
  }
}
