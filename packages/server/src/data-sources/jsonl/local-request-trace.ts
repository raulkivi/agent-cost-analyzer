// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import type { PromptChangeMarker, RequestTrace, TraceRequest, UntracedTurn } from "@agent-cost-analyzer/domain";
import type { CacheBreakTrace } from "../log-providers/log-provider.js";
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

interface TracedSpan {
  turnIndex: number;
  span: JsonlEnvelope;
  figures: Figures;
}

// A turn is traced whole or not at all; a log turn that can't be placed is
// left out rather than put in the wrong turn (as readSession does). Every
// session turn with no traced request is listed with its reason. `accept`
// narrows the spans considered (the main agent, for the cache-break trace).
function tracedSpans(input: LocalRequestTraceInput, accept: (span: JsonlEnvelope) => boolean): { spans: TracedSpan[]; reasons: Map<number, string> } {
  const spans: TracedSpan[] = [];
  const reasons = new Map<number, string>();
  groupEnvelopesByUserMessage(input.envelopes).forEach((group, logTurn) => {
    const turnIndex = input.alignment[logTurn];
    if (turnIndex === null || turnIndex === undefined) return;
    const requests = group.filter((envelope) => envelope.type === "llm_request" && accept(envelope));
    if (requests.length === 0) return;
    const figures = requests.map((span) => figuresOf(span, input.agentTraceUsage));
    if (figures.some((value) => value === null)) {
      reasons.set(turnIndex, UNUSABLE_REQUEST_REASON);
      return;
    }
    requests.forEach((span, position) => spans.push({ turnIndex, span, figures: figures[position]! }));
  });
  return { spans, reasons };
}

function assemble(input: LocalRequestTraceInput, { spans, reasons }: ReturnType<typeof tracedSpans>): RequestTrace {
  const requests: TraceRequest[] = [];
  for (const { turnIndex, figures } of spans) {
    const previous = requests.at(-1);
    const startedAt = previous && figures.startedAt < previous.startedAt ? previous.startedAt : figures.startedAt;
    const switched = previous !== undefined && previous.model !== figures.model;
    requests.push({ index: requests.length, turnIndex, ...figures, startedAt, ...(switched ? { event: "model-switch" as const } : {}) });
  }
  const traced = new Set(requests.map((request) => request.turnIndex));
  const notTraced: UntracedTurn[] = [...new Set(input.sessionTurnIndexes)]
    .sort((a, b) => a - b)
    .filter((turnIndex) => !traced.has(turnIndex))
    .map((turnIndex) => ({ turnIndex, reason: reasons.get(turnIndex) ?? NOT_IN_DEBUG_LOG_REASON }));
  return { sessionId: input.sessionId, providerId: PROVIDER_ID, harness: "vscode-local", requests, notTraced };
}

export function buildLocalRequestTrace(input: LocalRequestTraceInput): RequestTrace {
  return assemble(input, tracedSpans(input, () => true));
}

// Phase 16 SR6 (docs/plans/savings-report.md §4 O3, §15 a): the cache follows
// one agent's prompt. The main agent is `debugName` panel/editAgent; the
// summariser, todo agent and language-model wrapper have their own prompt and
// tools files, so their requests are left out of this trace.
export const MAIN_AGENT_DEBUG_NAME = "panel/editAgent";

const isMainAgent = (span: JsonlEnvelope): boolean => span.attrs?.debugName === MAIN_AGENT_DEBUG_NAME;

// The prompt and tools file names the main agent's requests name, for the
// caller to hash (it owns the file access).
export function promptFileNames(envelopes: readonly JsonlEnvelope[]): string[] {
  const names = new Set<string>();
  for (const span of envelopes) {
    if (span.type !== "llm_request" || !isMainAgent(span)) continue;
    for (const key of ["systemPromptFile", "toolsFile"] as const) {
      const name = span.attrs?.[key];
      if (typeof name === "string") names.add(name);
    }
  }
  return [...names];
}

export interface LocalCacheBreakInput extends LocalRequestTraceInput {
  // Content hash of each prompt or tools file by name; null when it could not
  // be read. Equal content under different names is the same prompt (SR0).
  fileHashes: ReadonlyMap<string, string | null>;
}

const digest = (text: string): string => createHash("sha256").update(text).digest("hex");

// The "Custom Instructions" text in force at each envelope (the latest event
// before it), as a hash: only whether it changed matters, never its text.
function instructionHashes(envelopes: readonly JsonlEnvelope[]): Map<JsonlEnvelope, string | undefined> {
  const at = new Map<JsonlEnvelope, string | undefined>();
  let current: string | undefined;
  for (const envelope of envelopes) {
    if (envelope.type === "generic" && envelope.name === "Custom Instructions" && typeof envelope.attrs?.details === "string") {
      current = digest(envelope.attrs.details);
    }
    at.set(envelope, current);
  }
  return at;
}

export function buildLocalCacheBreakTrace(input: LocalCacheBreakInput): CacheBreakTrace {
  const traced = tracedSpans(input, isMainAgent);
  const trace = assemble(input, traced);
  const instructions = instructionHashes(input.envelopes);
  const hashOf = (span: JsonlEnvelope, key: "systemPromptFile" | "toolsFile"): string | undefined => {
    const name = span.attrs?.[key];
    return typeof name === "string" ? (input.fileHashes.get(name) ?? undefined) : undefined;
  };
  const promptChanges = new Map<number, PromptChangeMarker>();
  traced.spans.forEach(({ span }, index) => {
    const previous = traced.spans[index - 1]?.span;
    if (previous === undefined) return;
    const marker: PromptChangeMarker = {};
    const compare = (field: keyof PromptChangeMarker, now: string | undefined, before: string | undefined) => {
      if (now !== undefined && before !== undefined) marker[field] = now !== before;
    };
    compare("tools", hashOf(span, "toolsFile"), hashOf(previous, "toolsFile"));
    compare("systemPrompt", hashOf(span, "systemPromptFile"), hashOf(previous, "systemPromptFile"));
    compare("instructions", instructions.get(span), instructions.get(previous));
    if (Object.keys(marker).length > 0) promptChanges.set(index, marker);
  });
  return { trace, promptChanges };
}
