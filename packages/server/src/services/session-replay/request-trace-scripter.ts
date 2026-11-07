// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type {
  RequestTrace,
  ScenarioScript,
  ScriptEvent,
  ScriptStep,
  TraceRequest,
} from "@agent-cost-analyzer/domain";

// Phase 14 step 14.3 (docs/plans/analyze-session-replay.md §4.2): a request
// trace as a ScenarioScript the Learn simulator can replay on any model. It
// replaces 13.5a's scriptFromCapture (same script for a trace that never
// shrinks, never reasons and never switches model; calibration replays its
// captures through it) and adds compaction, clear, model switches and
// 1-hour writes. The script is built so that each
// simulated prompt (tools + system + messages) is the request's input total.

export class EmptyRequestTraceError extends Error {
  constructor(sessionId: string) {
    super(
      `Session "${sessionId}" has no traced requests, so it can't be replayed`,
    );
    this.name = "EmptyRequestTraceError";
  }
}

// Everything the request sent. Null writes are already inside
// uncachedInput (A4); the simulator infers them, so none is invented here.
export function requestInputTotal(request: TraceRequest): number {
  return request.uncachedInput + request.cacheRead + (request.cacheWrite ?? 0);
}

// Reasoning is billed as output but never carried into the next prompt.
export function carriedOutput(request: TraceRequest): number {
  return Math.max(0, request.output - (request.reasoning ?? 0));
}

// How a request's prompt relates to the previous one's.
type Transition =
  | { kind: "grow"; added: number }
  // The messages were cleared before this request.
  | { kind: "clear" }
  // The previous request was the compaction request; this one starts from
  // its summary.
  | { kind: "after-compaction" };

export function transitionOf(
  request: TraceRequest,
  previous: TraceRequest,
): Transition {
  if (request.event === "clear") return { kind: "clear" };
  const added =
    requestInputTotal(request) -
    requestInputTotal(previous) -
    carriedOutput(previous);
  if (added < 0 || request.event === "compaction") {
    return { kind: "after-compaction" };
  }
  return { kind: "grow", added };
}

// The tools and system prompt every request is assumed to start with: the
// smallest prompt the messages were ever reset to, never more than the
// first prompt, so that every reset prompt still holds the whole prefix.
export function staticPrefixTotal(
  requests: TraceRequest[],
  transitions: Transition[],
): number {
  return requests.reduce(
    (prefix, request, position) =>
      position > 0 && transitions[position]!.kind !== "grow"
        ? Math.min(prefix, requestInputTotal(request))
        : prefix,
    requestInputTotal(requests[0]!),
  );
}

// The first request's model is the primary role and any other model is the
// cheaper role, so a third distinct model maps to "cheaper" too (no event
// between two non-primary models). Which model each role is priced as is
// step 14.4's decision. The change itself is used, not only the trace's
// model-switch event, so a missing or stray event can't mislead the replay.
export function modelSwitchEvents(requests: TraceRequest[]): ScriptEvent[][] {
  const primaryModel = requests[0]!.model;
  let role: "primary" | "cheaper" = "primary";
  return requests.map((request) => {
    const wanted = request.model === primaryModel ? "primary" : "cheaper";
    if (wanted === role) return [];
    role = wanted;
    return [{ type: "model-switch", toRole: wanted }];
  });
}

// The 1-hour lifetime starts on the first request that wrote with it. On
// every calibration capture that is request 0, where 13.5a's
// scriptFromCapture put it, so calibration keeps the same script.
export function extendedTtlStep(requests: TraceRequest[]): number {
  return requests.findIndex((r) => (r.extendedCacheWrite ?? 0) > 0);
}

export function idleMinutes(
  request: TraceRequest,
  previous?: TraceRequest,
): number {
  if (previous === undefined) return 0;
  return (
    (Date.parse(request.startedAt) - Date.parse(previous.startedAt)) / 60_000
  );
}

const emptyStep = (
  request: TraceRequest,
  previous: TraceRequest | undefined,
  userTokens: number,
  events: ScriptEvent[],
): ScriptStep => ({
  index: request.index + 1,
  userMessage: "",
  assistantResponse: "",
  toolCalls: [],
  explanation: "",
  idleMinutesBefore: idleMinutes(request, previous),
  newContent: {
    userTokens,
    toolResultTokens: 0,
    reasoningTokens: request.reasoning ?? 0,
    outputTokens: carriedOutput(request),
  },
  events,
});

export function scriptFromRequestTrace(trace: RequestTrace): ScenarioScript {
  const { requests } = trace;
  if (requests.length === 0) throw new EmptyRequestTraceError(trace.sessionId);

  const transitions: Transition[] = requests.map((request, position) =>
    position === 0
      ? { kind: "grow", added: 0 }
      : transitionOf(request, requests[position - 1]!),
  );
  const prefix = staticPrefixTotal(requests, transitions);
  // Same split as 13.5a's scriptFromCapture: usage numbers can't show it, and only
  // tools/system events would depend on it.
  const toolsTokens = Math.round(prefix / 2);
  const switches = modelSwitchEvents(requests);
  const extendedAt = extendedTtlStep(requests);

  const steps = requests.map((request, position): ScriptStep => {
    const transition = transitions[position]!;
    const events: ScriptEvent[] = [];
    if (transition.kind === "clear") events.push({ type: "clear" });
    events.push(...switches[position]!);
    if (position === extendedAt) events.push({ type: "extended-ttl" });
    const userTokens =
      position === 0
        ? requestInputTotal(request) - prefix
        : transition.kind === "grow"
          ? transition.added
          : transition.kind === "clear"
            ? requestInputTotal(request) - prefix
            : 0;
    return emptyStep(request, requests[position - 1], userTokens, events);
  });

  // The simulator applies a compaction after its own request: the next
  // prompt's messages are the summary, here the whole of it beyond the prefix.
  transitions.forEach((transition, position) => {
    if (transition.kind !== "after-compaction") return;
    steps[position - 1]!.events.push({
      type: "compaction",
      summaryTokens: requestInputTotal(requests[position]!) - prefix,
    });
  });

  return {
    id: trace.sessionId,
    title: trace.sessionId,
    category: "replay",
    harnesses: [trace.harness],
    sessionKind: "main",
    staticPrefix: { toolsTokens, systemTokens: prefix - toolsTokens },
    steps,
  };
}

// For callers that want the scripter as an injectable collaborator.
export class RequestTraceScripter {
  script(trace: RequestTrace): ScenarioScript {
    return scriptFromRequestTrace(trace);
  }
}
