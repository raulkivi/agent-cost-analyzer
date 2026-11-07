import type {
  CacheOutcome,
  Currency,
  MeasuredCost,
  ReplayCoverage,
  ReplayTotal,
  ReplayTurn,
  RequestTrace,
  SessionReplay,
  SimulatedCost,
} from "@agent-cost-analyzer/domain";

// Phase 14 step 14.4 (docs/plans/analyze-session-replay.md §4.4, §8): the
// simulated requests summed back into the session's turns, so each turn row
// has its measured and simulated figures side by side, with totals and
// coverage. Pure; an unknown is a reason, never 0 (constraint 6).

// One simulated request with known counts.
export interface ReplayRequestFigures {
  cacheRead: number;
  cacheWrite: number;
  outcome: CacheOutcome;
  cost: SimulatedCost;
}
// A simulated request whose counts are unknown, with the reason.
export type SimulatedRequest = ReplayRequestFigures | { unknown: string };

export interface AlignReplayInput {
  trace: RequestTrace;
  // The session's turns (readSession).
  turnCount: number;
  // Indexed by session turn, length turnCount; costs already in `currency`.
  measured: { cacheRead: number | null; cost: MeasuredCost }[];
  // One per trace request, in the same order.
  simulated: SimulatedRequest[];
  // The replay's currency.
  currency: Currency;
}

export interface AlignedReplay {
  turns: ReplayTurn[];
  totals: SessionReplay["totals"];
  coverage: ReplayCoverage;
}

// Defensive: a turn that is neither traced nor listed as not traced.
export const NO_TRACED_REQUEST_REASON =
  "No request of this turn is in the session's trace.";
const UNKNOWN_OUTCOME_REASON =
  "The simulated cache outcome of a request in this turn is unknown.";

type Simulated = NonNullable<ReplayTurn["simulated"]>;

function unknownReason(request: SimulatedRequest): string | undefined {
  if ("unknown" in request) return request.unknown;
  return request.outcome === "unknown" ? UNKNOWN_OUTCOME_REASON : undefined;
}

// Rule: a turn's outcome is "miss" if any of its requests missed, else
// "partial" if any was partial, else "hit". Callers pass known requests only.
function turnOutcome(requests: ReplayRequestFigures[]): CacheOutcome {
  const outcomes = new Set(requests.map((r) => r.outcome));
  if (outcomes.has("miss")) return "miss";
  if (outcomes.has("partial")) return "partial";
  return "hit";
}

// Rule: a turn's simulated cost is known only when every request's cost is
// known and in the replay's currency (their sum); otherwise it is unknown,
// with the first request's reason.
function turnCost(
  requests: ReplayRequestFigures[],
  currency: Currency,
): SimulatedCost {
  let value = 0;
  for (const { cost } of requests) {
    if (!cost.known) return cost;
    if (cost.currency !== currency) {
      return {
        known: false,
        reason: `A request's simulated cost is in ${cost.currency}, not the replay's ${currency}.`,
      };
    }
    value += cost.value;
  }
  return { known: true, value, currency };
}

// Rule: a traced turn is replayed when every one of its requests has known
// simulated counts: cache read and write are the sums of its requests. A
// turn with any unknown request is not replayed, with that request's reason,
// so a replayed turn never holds unknown counts.
function simulateTurn(
  requests: SimulatedRequest[],
  currency: Currency,
): { simulated: Simulated } | { reason: string } {
  for (const request of requests) {
    const reason = unknownReason(request);
    if (reason !== undefined) return { reason };
  }
  const known = requests as ReplayRequestFigures[];
  return {
    simulated: {
      cacheRead: known.reduce((sum, r) => sum + r.cacheRead, 0),
      cacheWrite: known.reduce((sum, r) => sum + r.cacheWrite, 0),
      outcome: turnOutcome(known),
      cost: turnCost(known, currency),
    },
  };
}

function checkInput(input: AlignReplayInput): void {
  const { trace, turnCount, measured, simulated, currency } = input;
  if (measured.length !== turnCount) {
    throw new Error(
      `alignReplay needs one measured figure per turn (${turnCount} turns, ${measured.length} measured)`,
    );
  }
  if (simulated.length !== trace.requests.length) {
    throw new Error(
      `alignReplay needs one simulated request per traced request (${trace.requests.length} requests, ${simulated.length} simulated)`,
    );
  }
  for (const { cost } of measured) {
    if (cost.known && cost.currency !== currency) {
      throw new Error(
        `A measured cost is in ${cost.currency}, not the replay's currency ${currency}: convert it first`,
      );
    }
  }
}

function total(values: number[], turns: number): ReplayTotal {
  return {
    value: values.length === 0 ? null : values.reduce((a, b) => a + b, 0),
    knownTurns: values.length,
    turns,
  };
}

export function alignReplay(input: AlignReplayInput): AlignedReplay {
  checkInput(input);
  const { trace, turnCount, measured, simulated, currency } = input;

  const requestsByTurn = new Map<number, SimulatedRequest[]>();
  trace.requests.forEach((request, position) => {
    const list = requestsByTurn.get(request.turnIndex) ?? [];
    list.push(simulated[position]!);
    requestsByTurn.set(request.turnIndex, list);
  });
  const untraced = new Map<number, string>();
  for (const { turnIndex, reason } of trace.notTraced) {
    if (!untraced.has(turnIndex)) untraced.set(turnIndex, reason);
  }

  // One ReplayTurn per session turn, in order; measured figures copied from
  // measured[turnIndex]. A turn with requests in the trace is replayed (a
  // provider traces a turn whole or not at all, so its requests win over a
  // stray notTraced entry); one in notTraced keeps that reason; one in
  // neither gets NO_TRACED_REQUEST_REASON. Requests of turns beyond
  // turnCount count in coverage.requests but are never replayed.
  let replayedRequests = 0;
  const turns: ReplayTurn[] = measured.map((figures, turnIndex) => {
    const base = {
      turnIndex,
      measured: { cacheRead: figures.cacheRead, cost: figures.cost },
    };
    const requests = requestsByTurn.get(turnIndex);
    if (requests === undefined) {
      const reason = untraced.get(turnIndex) ?? NO_TRACED_REQUEST_REASON;
      return { ...base, simulated: null, notReplayedReason: reason };
    }
    const result = simulateTurn(requests, currency);
    if ("reason" in result) {
      return { ...base, simulated: null, notReplayedReason: result.reason };
    }
    replayedRequests += requests.length;
    return { ...base, simulated: result.simulated };
  });

  // Totals compare like with like: both are over the same "paired" turns,
  // those replayed with a known simulated cost and a known measured cost.
  // Sums keep full precision (no rounding in the domain); the difference is
  // simulated − measured, null when either total is.
  const measuredValues: number[] = [];
  const simulatedValues: number[] = [];
  for (const turn of turns) {
    const sim = turn.simulated?.cost;
    if (sim?.known && turn.measured.cost.known) {
      simulatedValues.push(sim.value);
      measuredValues.push(turn.measured.cost.value);
    }
  }
  const measuredTotal = total(measuredValues, turnCount);
  const simulatedTotal = total(simulatedValues, turnCount);
  const difference =
    measuredTotal.value === null || simulatedTotal.value === null
      ? null
      : simulatedTotal.value - measuredTotal.value;

  // Coverage: the reasons turns weren't replayed, with their turn counts, in
  // first-seen order.
  const notReplayed: ReplayCoverage["notReplayed"] = [];
  for (const { notReplayedReason } of turns) {
    if (notReplayedReason === undefined) continue;
    const entry = notReplayed.find((e) => e.reason === notReplayedReason);
    if (entry) entry.turns += 1;
    else notReplayed.push({ reason: notReplayedReason, turns: 1 });
  }

  return {
    turns,
    totals: { measured: measuredTotal, simulated: simulatedTotal, difference },
    coverage: {
      turns: turnCount,
      replayedTurns: turns.filter((t) => t.simulated !== null).length,
      requests: trace.requests.length,
      replayedRequests,
      notReplayed,
    },
  };
}
