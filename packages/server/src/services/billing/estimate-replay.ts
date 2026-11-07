import { AI_CREDIT_CONVERSION_NOTE, unknownCost, type CostEstimate, type CostFigure, type ReplayAssumption, type SessionReplay } from "@agent-cost-analyzer/domain";
import type { CostCubeRow } from "../cost-analysis/cost-cube.js";
import { turnKeyOf } from "../insights/insights-dataset-builder.js";
import type { ReplayModelResolution } from "../session-replay/replay-model-resolver.js";
import { REPLAY_ASSUMPTIONS, type SessionReplayQueries } from "../session-replay/session-replay-service.js";
import type { EstimateFigureOf } from "./estimate-builder.js";

// Phase 14 step 14.5 (docs/plans/analyze-session-replay.md §9, D7; closes
// Phase 15's D17): an estimate on another model. Each of the target's
// sessions in the history window is replayed on that model once (the same
// SessionReplayService replay_session answers with, priced on the session's
// own channel as of its dates, D2), and each turn's simulated cost replaces
// its priced one; buildCostEstimate's rules then apply unchanged. A turn not
// replayed, or replayed with no price, leaves its unit out, counted by
// reason (constraint 6: never 0).

export type EstimateSimulation = NonNullable<CostEstimate["simulation"]>;

// The model resolver's narrow port (ReplayModelResolver satisfies it).
export interface EstimateModelResolver {
  resolve(model: string): ReplayModelResolution;
}

export interface EstimateReplaySources {
  sessions: Pick<SessionReplayQueries, "replay">;
  models: EstimateModelResolver;
}

// threat-model.md §4: a bound on the replays one estimate runs (each is
// bounded by MAX_REPLAY_REQUESTS); 12 weeks of daily use stays well within it.
export const MAX_ESTIMATE_REPLAY_SESSIONS = 200;

export class EstimateModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EstimateModelError";
  }
}

export const NO_REPLAY_REASON =
  "Estimating on another model isn't available here: it needs the price book and the vendor profiles that replays run on.";
const UNREADABLE_SESSION_REASON = "The session could not be read again to replay it.";
const NOT_IN_REPLAY_REASON = "The turn isn't in the session's replay.";
const DEFAULT_ASSUMPTIONS: ReplayAssumption[] = [REPLAY_ASSUMPTIONS.A1, REPLAY_ASSUMPTIONS.A2, REPLAY_ASSUMPTIONS.A3, REPLAY_ASSUMPTIONS.A5];

export function resolveEstimateModel(sources: EstimateReplaySources | undefined, model: string): Extract<ReplayModelResolution, { known: true }> {
  if (!sources) throw new EstimateModelError(NO_REPLAY_REASON);
  const resolved = sources.models.resolve(model);
  if (!resolved.known) throw new EstimateModelError(resolved.reason);
  return resolved;
}

const methodOf = (model: string) =>
  `Each of the target's sessions in the window is replayed on ${model} as replay_session does (the same requests and token counts through ${model}'s vendor caching rules), priced on the session's own channel as of when it ran (Copilot sessions at Copilot prices, others at the vendor's API price). ` +
  "A unit's cost is the sum of its turns' simulated costs; the range is the median and 90th-percentile unit cost × the planned units, as for the measured estimate. A unit with any turn not replayed or unpriced is left out and counted by reason.";

export const simulatedConversion = (model: string) =>
  `Every amount is in USD, simulated on ${model} and priced as of each session's own dates on its own channel, not at today's prices: AI Credits converted at ${AI_CREDIT_CONVERSION_NOTE}`;

function figureOfTurn(turn: SessionReplay["turns"][number]): CostFigure {
  if (turn.simulated === null) return unknownCost(turn.notReplayedReason ?? NOT_IN_REPLAY_REASON);
  const { cost } = turn.simulated;
  return cost.known ? { known: true, amount: cost.value, currency: cost.currency, basis: "priced" } : unknownCost(cost.reason);
}

export async function replayEstimateRows(
  rows: readonly CostCubeRow[],
  sources: EstimateReplaySources,
  target: Extract<ReplayModelResolution, { known: true }>,
  historyWeeks: number,
): Promise<{ figureOf: EstimateFigureOf; simulation: EstimateSimulation }> {
  const sessions = new Map<string, { providerId: string; sessionId: string }>();
  for (const row of rows) if (!sessions.has(row.sessionKey)) sessions.set(row.sessionKey, { providerId: row.providerId, sessionId: row.sessionId });
  if (sessions.size > MAX_ESTIMATE_REPLAY_SESSIONS) {
    throw new EstimateModelError(
      `The target has ${sessions.size} sessions in the last ${historyWeeks} weeks; at most ${MAX_ESTIMATE_REPLAY_SESSIONS} can be replayed for one estimate.${historyWeeks > 4 ? " Try the last 4 weeks (historyWeeks: 4)." : ""}`,
    );
  }

  const figures = new Map<string, CostFigure>();
  const sessionReasons = new Map<string, string>();
  const assumptions = new Map<string, ReplayAssumption>();
  let replayedSessions = 0;
  let checked = 0;
  let passed = 0;
  for (const [sessionKey, { providerId, sessionId }] of sessions) {
    const result = await sources.sessions.replay({ sessionId, providerId, model: target.modelId, pricing: "session-channel" });
    if (result.status !== "ok") {
      sessionReasons.set(sessionKey, result.status === "unknown-session" ? UNREADABLE_SESSION_REASON : result.reason);
      continue;
    }
    replayedSessions += 1;
    if (result.value.selfCheck) {
      checked += 1;
      if (result.value.selfCheck.passed) passed += 1;
    }
    for (const assumption of result.value.assumptions) assumptions.set(assumption.id, assumption);
    for (const turn of result.value.turns) figures.set(turnKeyOf(sessionKey, turn.turnIndex), figureOfTurn(turn));
  }

  const figureOf: EstimateFigureOf = (row) => {
    const reason = sessionReasons.get(row.sessionKey);
    return reason !== undefined ? unknownCost(reason) : (figures.get(row.turnKey) ?? unknownCost(NOT_IN_REPLAY_REASON));
  };
  const notReplayed = new Map<string, number>();
  let replayedTurns = 0;
  for (const row of rows) {
    const figure = figureOf(row);
    if (figure.known) replayedTurns += 1;
    else notReplayed.set(figure.reason, (notReplayed.get(figure.reason) ?? 0) + 1);
  }

  return {
    figureOf,
    simulation: {
      label: "simulated",
      model: target.modelId,
      vendorId: target.vendorId,
      method: methodOf(target.modelId),
      sessions: sessions.size,
      replayedSessions,
      turns: rows.length,
      replayedTurns,
      notReplayed: [...notReplayed].map(([reason, turns]) => ({ reason, turns })),
      selfCheck: { checked, passed },
      assumptions: assumptions.size > 0 ? [...assumptions.values()].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true })) : DEFAULT_ASSUMPTIONS,
    },
  };
}
