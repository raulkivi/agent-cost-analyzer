// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { unavailableTokenCount, type SubagentRunUsage, type TokenCount } from "@agent-cost-analyzer/domain";
import type { ChildSessionRef } from "./child-session-refs.js";
import { extractLlmRequestUsage, type LlmRequestUsage } from "./llm-request-extractor.js";
import type { JsonlEnvelope } from "./main-jsonl-reader.js";
import type { AgentTraceUsage } from "../agent-traces/agent-traces-reader.js";
import {
  aggregateAgentTraceUsage,
  AGENT_TRACES_UNAVAILABLE_REASON,
  AI_CREDITS_NOT_AVAILABLE_REASON,
} from "./session-usage-spans.js";

const UNKNOWN_MODEL = "unknown";
export const MAX_SUBAGENT_MODEL_LENGTH = 64;
const MAX_AGENT_NAME_LENGTH = 64;

// The same patterns subagentRunUsageSchema holds: the text comes from a log
// file and reaches the UI and MCP tools, so it is checked here, not trusted.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LABEL_PATTERN = /^(runSubagent-[A-Za-z0-9_ -]{1,64}|searchSubagent)$/;
const AGENT_NAME_PATTERN = new RegExp(`^[A-Za-z0-9_ .-]{1,${MAX_AGENT_NAME_LENGTH}}$`);
const MODEL_PATTERN = new RegExp(`^[A-Za-z0-9_.:/@+-]{1,${MAX_SUBAGENT_MODEL_LENGTH}}$`);

export const NESTED_SUBAGENTS_REASON =
  "A subagent run started another subagent run, which is not read, so the AI Credits it used are unknown.";
export const SUBAGENT_LOG_INCOMPLETE_REASON =
  "The subagent log has lines that could not be parsed, so its figures may leave requests out.";
export const SUBAGENT_REQUEST_UNUSABLE_REASON =
  "The subagent log has an llm_request without numeric token counts, so its figures may leave a request out.";

export type SubagentRunRead =
  | { status: "read"; run: SubagentRunUsage }
  // No schema-valid run can stand for the file; the caller makes the session
  // total unknown (constraint 6) instead of dropping it.
  | { status: "unreadable"; reason: string };

export type SubagentRunIdentity = Pick<ChildSessionRef, "childSessionId" | "label">;

function firstMatching(pattern: RegExp, candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && pattern.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

function startedAtOf(start: JsonlEnvelope | undefined): string | undefined {
  const ts = start?.ts;
  if (typeof ts !== "number" || !Number.isFinite(ts)) {
    return undefined;
  }
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// Same rule as session-usage-spans.ts: the latest request with a known model.
// A model that isn't a short plain identifier counts as unknown.
function latestKnownModel(requests: LlmRequestUsage[]): string {
  for (let i = requests.length - 1; i >= 0; i--) {
    if (requests[i].model !== UNKNOWN_MODEL && MODEL_PATTERN.test(requests[i].model)) {
      return requests[i].model;
    }
  }
  return UNKNOWN_MODEL;
}

function aiCreditsOf(requests: LlmRequestUsage[]): TokenCount {
  let total = 0;
  for (const request of requests) {
    if (request.aiCredits === null) {
      return unavailableTokenCount(AI_CREDITS_NOT_AVAILABLE_REASON);
    }
    total += request.aiCredits;
  }
  return { known: true, value: total };
}

function known(value: number): TokenCount {
  return { known: true, value };
}

// One classic subagent run's usage from its own log file (step 10.19): the sum
// of its llm_requests, built with extractLlmRequestUsage so nano-AIU becomes AI
// Credits exactly as for the parent. AI Credits are all-or-nothing, as for a
// turn. A figure that could leave a request out is unknown, never a partial
// sum (constraint 6):
//  - the run holds a child_session_ref (nested runs aren't read);
//  - an llm_request has no numeric token counts;
//  - more than one raw line failed to parse. One is tolerated: a live run's
//    last line may be partial, and it is skipped as for main.jsonl ("as of now").
// A run with no llm_request is a known 0 requests and 0 AI Credits.
export function extractSubagentRunUsage(
  envelopes: JsonlEnvelope[],
  rawLineCount: number,
  ref: SubagentRunIdentity,
  attribution: SubagentRunUsage["attribution"] = "child-session-ref",
  // The agent-traces.db rows by responseId (the detail read only). Without it
  // cacheWrite and reasoning stay unknown, as in the list.
  agentTraceUsage?: ReadonlyMap<string, AgentTraceUsage>,
): SubagentRunRead {
  if (envelopes.length === 0) {
    return { status: "unreadable", reason: "The subagent log has no readable events." };
  }

  const start = envelopes.find((envelope) => envelope.type === "session_start");
  const id = firstMatching(ID_PATTERN, [ref.childSessionId, start?.sid]);
  const label = firstMatching(LABEL_PATTERN, [ref.label, start?.attrs?.label]);
  if (id === null || label === null) {
    return { status: "unreadable", reason: "The subagent log has no usable id or label." };
  }

  const requestEnvelopes = envelopes.filter((envelope) => envelope.type === "llm_request");
  const requests = requestEnvelopes.map(extractLlmRequestUsage).filter((usage) => usage !== null);
  const agentName = firstMatching(
    AGENT_NAME_PATTERN,
    envelopes.filter((envelope) => envelope.type === "subagent").map((envelope) => envelope.attrs?.agentName),
  );

  const unknownReason = envelopes.some((envelope) => envelope.type === "child_session_ref")
    ? NESTED_SUBAGENTS_REASON
    : rawLineCount - envelopes.length > 1
      ? SUBAGENT_LOG_INCOMPLETE_REASON
      : requests.length < requestEnvelopes.length
        ? SUBAGENT_REQUEST_UNUSABLE_REASON
        : null;

  const sum = (pick: (request: LlmRequestUsage) => number): TokenCount =>
    unknownReason === null ? known(requests.reduce((total, request) => total + pick(request), 0)) : unavailableTokenCount(unknownReason);

  // Same all-or-nothing join as a turn's: unknown when any request's
  // responseId is missing from the rows.
  const joined =
    unknownReason !== null
      ? { cacheWrite: unavailableTokenCount(unknownReason), reasoning: unavailableTokenCount(unknownReason) }
      : agentTraceUsage === undefined
        ? { cacheWrite: unavailableTokenCount(AGENT_TRACES_UNAVAILABLE_REASON), reasoning: unavailableTokenCount(AGENT_TRACES_UNAVAILABLE_REASON) }
        : aggregateAgentTraceUsage(requests, agentTraceUsage);

  const startedAt = startedAtOf(start);
  return {
    status: "read",
    run: {
      id,
      label,
      ...(agentName === null ? {} : { agentName }),
      model: latestKnownModel(requests),
      roundsCount: requestEnvelopes.length,
      uncachedInput: sum((request) => request.uncachedInput),
      cacheWrite: joined.cacheWrite,
      cacheRead: sum((request) => request.cacheRead),
      reasoning: joined.reasoning,
      output: sum((request) => request.output),
      costAiCredits: unknownReason === null ? aiCreditsOf(requests) : unavailableTokenCount(unknownReason),
      ...(startedAt === undefined ? {} : { startedAt }),
      attribution,
    },
  };
}
