// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  REPLAY_READ_TOLERANCE_PERCENT,
  type ReplaySelfCheck,
  type RequestTrace,
  type Session,
  type TraceRequest,
  type Turn,
} from "@agent-cost-analyzer/domain";
import { recordedOutcome } from "../learn-simulation/calibration/replay.js";
import { requestInputTotal } from "./request-trace-scripter.js";

// Phase 14 step 14.4 (docs/plans/analyze-session-replay.md §4.5, G4): the
// session's script simulated on the session's own model(s), compared request
// by request with the trace. It is 13.5a calibration's check (D12 there):
// a request matches when the simulated cache outcome is the recorded one and
// the simulated cache read is within REPLAY_READ_TOLERANCE_PERCENT of the
// recorded read. `simulated.turns[i]` is `trace.requests[i]`'s simulation.

// A3 (cold start): the first request isn't compared, as in calibration; it
// depends on caches other sessions left warm, which the trace can't show.
function matches(
  request: TraceRequest,
  previous: TraceRequest,
  turn: Turn,
): boolean {
  // Unknown simulated counts never match: an unknown is never a pass.
  if (!turn.usage.cacheRead.known || turn.simulation === undefined) {
    return false;
  }
  const outcome = recordedOutcome(
    request.cacheRead,
    requestInputTotal(previous),
  );
  const tolerance = (REPLAY_READ_TOLERANCE_PERCENT / 100) * request.cacheRead;
  return (
    turn.simulation.cacheOutcome === outcome &&
    Math.abs(turn.usage.cacheRead.value - request.cacheRead) <= tolerance
  );
}

// The trace indexes of the compared requests that don't match.
export function selfCheckMismatches(
  trace: RequestTrace,
  simulated: Session,
): number[] {
  const { requests } = trace;
  if (simulated.turns.length !== requests.length) {
    throw new Error(
      `The self-check needs one simulated turn per request (${requests.length} requests, ${simulated.turns.length} turns)`,
    );
  }
  return requests
    .slice(1)
    .filter(
      (request, i) => !matches(request, requests[i]!, simulated.turns[i + 1]!),
    )
    .map((request) => request.index);
}

export function replaySelfCheck(
  trace: RequestTrace,
  simulated: Session,
  model: string,
): ReplaySelfCheck {
  // A one-request trace compares nothing (A3), so 0 of 0 match and it passes.
  const requests = Math.max(0, trace.requests.length - 1);
  const matching = requests - selfCheckMismatches(trace, simulated).length;
  return {
    model,
    requests,
    matching,
    readTolerancePercent: REPLAY_READ_TOLERANCE_PERCENT,
    passed: matching === requests,
  };
}
