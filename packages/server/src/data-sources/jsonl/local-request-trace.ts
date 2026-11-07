// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { RequestTrace, TraceRequest, UntracedTurn } from "@agent-cost-analyzer/domain";
import type { AgentTraceUsage } from "../agent-traces/agent-traces-reader.js";
import type { JsonlEnvelope } from "./main-jsonl-reader.js";
import { groupEnvelopesByUserMessage } from "./session-usage-spans.js";

// Phase 14 step 14.2 (docs/plans/analyze-session-replay.md §4.1, §5): a
// local-harness Copilot session as one record per llm_request span of its
// debug log (main.jsonl), numbers only. Log turns are placed in the
// session's turns by the alignment readSession uses (log-turn-alignment.ts),
// so a record's turnIndex is the session's.

export const PROVIDER_ID = "vscode";
export const NOT_IN_DEBUG_LOG_REASON =
  "Copilot Chat's debug log (main.jsonl) has no request for this turn: logging was off then, or the log couldn't be matched to it.";
export const UNUSABLE_REQUEST_REASON =
  "A request in this turn's debug log has no complete token counts (input, cached, output), model or time.";

export interface LocalRequestTraceInput {
  sessionId: string;
  envelopes: JsonlEnvelope[];
  // Per log turn (one per user_message), its session turn index or null when
  // it can't be placed (alignLogTurnsToStore).
  alignment: (number | null)[];
  // Every turn the session lists (store rows and placed log turns).
  sessionTurnIndexes: number[];
  // agent-traces.db's cache writes and reasoning by response id (Phase 8.5).
  agentTraceUsage: Map<string, AgentTraceUsage>;
}

type Figures = Omit<TraceRequest, "index" | "turnIndex" | "event">;

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;

// The log's inputTokens is the whole input, cached part included; cache
// writes are recorded only in agent-traces.db. Without it they stay inside
// uncachedInput and cacheWrite is null, never 0 (constraint 6; the replay
// infers them, plan assumption A4).
function figuresOf(envelope: JsonlEnvelope, agentTraceUsage: Map<string, AgentTraceUsage>): Figures | null {
  const attrs = envelope.attrs ?? {};
  const input = count(attrs.inputTokens);
  const cached = count(attrs.cachedTokens);
  const output = count(attrs.outputTokens);
  const model = typeof attrs.model === "string" && attrs.model !== "" ? attrs.model : undefined;
  const at = typeof envelope.ts === "number" && Number.isFinite(envelope.ts) ? envelope.ts : undefined;
  if (input === undefined || cached === undefined || output === undefined || model === undefined || at === undefined || cached > input) return null;
  const traced = typeof attrs.responseId === "string" ? agentTraceUsage.get(attrs.responseId) : undefined;
  const write = traced ? Math.min(traced.cacheWrite, input - cached) : null;
  return {
    startedAt: new Date(at).toISOString(),
    model,
    uncachedInput: input - cached - (write ?? 0),
    cacheRead: cached,
    cacheWrite: write,
    output,
    ...(traced ? { reasoning: Math.min(traced.reasoning, output) } : {}),
  };
}

// A turn is traced whole or not at all; a log turn that can't be placed is
// left out rather than put in the wrong turn (as readSession does). Every
// session turn with no traced request is listed with its reason.
export function buildLocalRequestTrace({ sessionId, envelopes, alignment, sessionTurnIndexes, agentTraceUsage }: LocalRequestTraceInput): RequestTrace {
  const requests: TraceRequest[] = [];
  const reasons = new Map<number, string>();
  groupEnvelopesByUserMessage(envelopes).forEach((group, logTurn) => {
    const turnIndex = alignment[logTurn];
    if (turnIndex === null || turnIndex === undefined) return;
    const spans = group.filter((envelope) => envelope.type === "llm_request");
    if (spans.length === 0) return;
    const figures = spans.map((span) => figuresOf(span, agentTraceUsage));
    if (figures.some((value) => value === null)) {
      reasons.set(turnIndex, UNUSABLE_REQUEST_REASON);
      return;
    }
    for (const value of figures as Figures[]) {
      const previous = requests.at(-1);
      const startedAt = previous && value.startedAt < previous.startedAt ? previous.startedAt : value.startedAt;
      const switched = previous !== undefined && previous.model !== value.model;
      requests.push({ index: requests.length, turnIndex, ...value, startedAt, ...(switched ? { event: "model-switch" as const } : {}) });
    }
  });
  const traced = new Set(requests.map((request) => request.turnIndex));
  const notTraced: UntracedTurn[] = [...new Set(sessionTurnIndexes)]
    .sort((a, b) => a - b)
    .filter((turnIndex) => !traced.has(turnIndex))
    .map((turnIndex) => ({ turnIndex, reason: reasons.get(turnIndex) ?? NOT_IN_DEBUG_LOG_REASON }));
  return { sessionId, providerId: PROVIDER_ID, harness: "vscode-local", requests, notTraced };
}
