import type {
  CacheOutcome,
  ScenarioScript,
  ScriptStep,
  VendorProfile,
} from "@agent-cost-analyzer/domain";
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

// The capture's input totals fix the script: each request's new content is
// what it adds beyond the previous prompt and the previous output.
export function scriptFromCapture(capture: CalibrationCapture): ScenarioScript {
  const [first, ...rest] = capture.requests;
  const firstInput = requestInputTokens(first!);
  // The tools/system split can't be seen in usage numbers; it only matters
  // for events, and a calibration capture has none.
  const toolsTokens = Math.round(firstInput / 2);
  const extended = capture.requests.some(
    (r) => (r.recorded.extendedCacheWrite ?? 0) > 0,
  );

  const step = (
    index: number,
    gap: number,
    newTokens: number,
    output: number,
    events: ScriptStep["events"],
  ): ScriptStep => ({
    index,
    userMessage: "",
    assistantResponse: "",
    toolCalls: [],
    explanation: "",
    idleMinutesBefore: gap,
    newContent: {
      userTokens: newTokens,
      toolResultTokens: 0,
      reasoningTokens: 0,
      outputTokens: output,
    },
    events,
  });

  const steps = [
    step(
      1,
      0,
      0,
      first!.recorded.output,
      extended ? [{ type: "extended-ttl" }] : [],
    ),
  ];
  let previous = first!;
  for (const request of rest) {
    const delta =
      requestInputTokens(request) -
      requestInputTokens(previous) -
      previous.recorded.output;
    if (delta < 0) {
      throw new Error(
        `Request ${request.index}: the prompt shrinks (${delta} tokens), which a script can't express`,
      );
    }
    steps.push(
      step(
        request.index + 1,
        request.gapMinutes,
        delta,
        request.recorded.output,
        [],
      ),
    );
    previous = request;
  }
  return {
    id: capture.id,
    title: capture.id,
    category: "calibration",
    harnesses: [capture.harness],
    sessionKind: "main",
    staticPrefix: { toolsTokens, systemTokens: firstInput - toolsTokens },
    steps,
  };
}

export function replayCapture(
  capture: CalibrationCapture,
  profile: VendorProfile,
): ReplayRow[] {
  const session = simulateScenario(scriptFromCapture(capture), {
    profile,
    modelId: capture.modelId,
    harness: capture.harness,
  });
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
