// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type {
  CacheOutcome,
  RequestTrace,
  VendorProfile,
} from "@agent-cost-analyzer/domain";
import { scriptFromRequestTrace } from "../../session-replay/request-trace-scripter.js";
import { simulateScenario } from "../simulate-scenario.js";
import { requestInputTokens, type CalibrationCapture } from "./capture.js";

export interface ReplayRow {
  index: number;
  recorded: { cacheRead: number; cacheWrite: number; outcome: CacheOutcome };
  simulated: { cacheRead: number; cacheWrite: number; outcome: CacheOutcome };
}

// The same definition the simulator uses: a hit reads everything the
// previous request left in the cache, a partial hit reads some of it.
export function recordedOutcome(
  cacheRead: number,
  previousInput: number,
): CacheOutcome {
  if (cacheRead === 0) return "miss";
  return cacheRead >= previousInput * 0.99 ? "hit" : "partial";
}

// Captures date from before request traces (step 14.2); as a trace they
// replay through the same scripter as a real session (step 14.3), so
// calibration checks the replay's own script. Times are rebuilt from the
// gaps, from an arbitrary start, to the millisecond.
const CAPTURE_START = Date.parse("2026-01-01T00:00:00.000Z");

export function traceFromCapture(capture: CalibrationCapture): RequestTrace {
  let elapsedMinutes = 0;
  return {
    sessionId: capture.id,
    providerId: capture.source,
    harness: capture.harness,
    notTraced: [],
    requests: capture.requests.map((request) => {
      elapsedMinutes += request.gapMinutes;
      const {
        uncachedInput,
        cacheRead,
        cacheWrite,
        extendedCacheWrite,
        output,
      } = request.recorded;
      return {
        index: request.index,
        turnIndex: request.index,
        startedAt: new Date(
          CAPTURE_START + Math.round(elapsedMinutes * 60_000),
        ).toISOString(),
        model: capture.modelId,
        uncachedInput,
        cacheRead,
        // A trace keeps the 1-hour writes inside all writes.
        cacheWrite: cacheWrite + (extendedCacheWrite ?? 0),
        ...(extendedCacheWrite === undefined ? {} : { extendedCacheWrite }),
        output,
      };
    }),
  };
}

export function replayCapture(
  capture: CalibrationCapture,
  profile: VendorProfile,
): ReplayRow[] {
  const session = simulateScenario(
    scriptFromRequestTrace(traceFromCapture(capture)),
    {
      profile,
      modelId: capture.modelId,
      harness: capture.harness,
      // The lifetime comes from what the capture recorded, not from the
      // harness default being tested.
      harnessCacheDefaults: false,
    },
  );
  return capture.requests.map((request, position) => {
    const turn = session.turns[position]!;
    const value = (count: { known: boolean; value?: number }): number =>
      count.known ? (count.value as number) : NaN;
    const previousInput =
      position === 0 ? 0 : requestInputTokens(capture.requests[position - 1]!);
    return {
      index: request.index,
      recorded: {
        cacheRead: request.recorded.cacheRead,
        cacheWrite:
          request.recorded.cacheWrite +
          (request.recorded.extendedCacheWrite ?? 0),
        outcome: recordedOutcome(request.recorded.cacheRead, previousInput),
      },
      simulated: {
        cacheRead: value(turn.usage.cacheRead),
        cacheWrite: value(turn.usage.cacheWrite),
        outcome: turn.simulation!.cacheOutcome,
      },
    };
  });
}
