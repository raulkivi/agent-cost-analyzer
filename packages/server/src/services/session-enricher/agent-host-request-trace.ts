// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { RequestTrace, TraceRequest, UntracedTurn } from "@agent-cost-analyzer/domain";
import { readCopilotCallUsage } from "./agent-host-call-usage.js";
import type { AgentHostEventLog } from "./agent-host-session-builder.js";
import { segmentCopilotTurns } from "./copilot-turn-segmenter.js";

// Phase 14 step 14.2 (docs/plans/analyze-session-replay.md §4.1, §5): an
// Agent Host session as one record per model call, numbers only, from the
// Copilot CLI event log's session.usage_record events (step 10.15). Turns
// come from the same matching as the turn inspector (copilot-turn-segmenter),
// so a record's turnIndex is the session's.

export const PROVIDER_ID = "vscode";
export const NO_MAIN_REQUEST_REASON =
  "This turn has no model call of its own in the Copilot CLI event log (none, or only a sub-agent's, which a replay leaves out).";
export const UNUSABLE_USAGE_REASON =
  "A model call in this turn has a usage record without complete token counts, a model or a valid time.";

type Figures = Omit<TraceRequest, "index" | "turnIndex" | "event">;

// Copilot's convention: inputTokens includes cache reads and writes, and
// outputTokens includes reasoning (agent-host-call-usage.ts). The trace's
// uncachedInput is what's left; with unknown writes (cacheDetailsReported
// false) the writes stay inside it and cacheWrite is null, never 0.
function figuresOf(event: Parameters<typeof readCopilotCallUsage>[0]): Figures | null {
  const usage = readCopilotCallUsage(event);
  const model = (event.data.usage as { model?: unknown } | undefined)?.model;
  const at = event.timestamp === null ? Number.NaN : Date.parse(event.timestamp);
  if (usage === null || typeof model !== "string" || model === "" || Number.isNaN(at)) return null;
  const written = usage.cacheWriteTokens;
  const counted = usage.cacheReadTokens + (written ?? 0);
  if (counted > usage.inputTokens) return null;
  return {
    startedAt: new Date(at).toISOString(),
    model,
    uncachedInput: usage.inputTokens - counted,
    cacheRead: usage.cacheReadTokens,
    cacheWrite: written,
    output: usage.outputTokens,
    ...(usage.reasoningTokens !== null ? { reasoning: Math.min(usage.reasoningTokens, usage.outputTokens) } : {}),
  };
}

// A turn is traced whole or not at all (a gap would break the chain the
// replay reads deltas from). Sub-agent calls (a top-level agentId) are left
// out of the main chain (D6). `turnCount` is session.db's, so with no
// readable log every turn is listed with the log's reason.
export function buildAgentHostRequestTrace(sessionId: string, turnCount: number, eventLog: AgentHostEventLog): RequestTrace {
  const requests: TraceRequest[] = [];
  const notTraced: UntracedTurn[] = [];
  const base = { sessionId, providerId: PROVIDER_ID, harness: "copilot-agent-host" as const };
  if (eventLog.status !== "read") {
    for (let turnIndex = 0; turnIndex < turnCount; turnIndex++) notTraced.push({ turnIndex, reason: eventLog.reason });
    return { ...base, requests, notTraced };
  }
  segmentCopilotTurns(eventLog.events, eventLog.turnRefs).turns.forEach((turn, turnIndex) => {
    if (!turn.matched) {
      notTraced.push({ turnIndex, reason: turn.reason });
      return;
    }
    const calls = turn.events.filter((event) => event.type === "session.usage_record" && event.agentId === null);
    if (calls.length === 0) {
      notTraced.push({ turnIndex, reason: NO_MAIN_REQUEST_REASON });
      return;
    }
    const figures = calls.map(figuresOf);
    if (figures.some((value) => value === null)) {
      notTraced.push({ turnIndex, reason: UNUSABLE_USAGE_REASON });
      return;
    }
    for (const value of figures as Figures[]) {
      const previous = requests.at(-1);
      const startedAt = previous && value.startedAt < previous.startedAt ? previous.startedAt : value.startedAt;
      const switched = previous !== undefined && previous.model !== value.model;
      requests.push({ index: requests.length, turnIndex, ...value, startedAt, ...(switched ? { event: "model-switch" as const } : {}) });
    }
  });
  return { ...base, requests, notTraced };
}
