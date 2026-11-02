import type {
  CopilotEventLogStatus,
  Session,
  TokenCount,
  Turn,
  TurnInspectorDetail,
  TurnUsage,
} from "@agent-cost-analyzer/domain";
import { sumTokenCounts, unavailableTokenCount } from "@agent-cost-analyzer/domain";
import type { AgentHostSessionRow } from "../../data-sources/agent-host/agent-host-catalog.js";
import {
  nanoAiuToAiCredits,
  type AgentHostTurnEventRef,
  type AgentHostTurnRow,
  type AgentHostTurnUsage,
} from "../../data-sources/agent-host/agent-session-store.js";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import { buildAgentHostSystemPrompt } from "./agent-host-system-prompt-builder.js";
import {
  buildAgentHostTurnContent,
  buildUnmatchedAgentHostTurnContent,
  indexToolOutcomeEvents,
  type AgentHostTurnContent,
} from "./agent-host-turn-content-builder.js";
import { buildAgentHostTurnInspector } from "./agent-host-turn-inspector-builder.js";
import { segmentCopilotTurns, TURN_EVENT_NOT_FOUND_REASON, type SegmentedTurn } from "./copilot-turn-segmenter.js";
import { buildAnalyzeExplanation, fallbackSessionTitle, UNKNOWN_MODEL } from "./session-enricher.js";

// Maps VS Code Agent Host sessions (vscode-extension.md steps 10.13 and
// 10.14) to the domain shapes, the counterpart of session-enricher.ts for
// classic Copilot Chat sessions: tokens and AI Credits from session.db, turn
// text, tool calls and the system prompt from the Copilot CLI event log.
// Pure: the readers in data-sources/agent-host/ do the I/O.

export const AGENT_HOST_FIELD_NOT_RECORDED_REASON =
  "VS Code's Agent Host doesn't record this token count (only input, cached input and output tokens per turn).";
export const AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON =
  "VS Code's Agent Host recorded no token totals for this turn.";
export const AGENT_HOST_TURN_COST_UNAVAILABLE_REASON =
  "VS Code's Agent Host recorded no AI Credits for this turn.";
export const AGENT_HOST_SESSION_COST_UNAVAILABLE_REASON =
  "VS Code's Agent Host recorded no AI Credits for at least one turn of this session, so its total is unknown.";
export const AGENT_HOST_NO_TURNS_REASON = "VS Code's Agent Host has recorded no turns for this session.";
export const AGENT_HOST_SESSION_DB_MISSING_REASON =
  "This session's Agent Host database (agentSessionData/<session>/session.db) is missing or unreadable, so its turns and usage are unknown.";
// Only when the event log wasn't opened (a list summary's turns); a read,
// missing or unreadable log explains itself.
export const AGENT_HOST_TURN_TEXT_UNAVAILABLE_NOTE =
  "This Agent Host session's Copilot CLI event log wasn't read, so this turn shows only its tokens and AI Credits.";

// What one session.db holds, already read; null when the file is missing.
export interface AgentHostSessionStoreContents {
  turns: AgentHostTurnRow[];
  model: string | null;
  title: string | null;
}

// Every event type the builders above read. The source parses only these,
// which drops the bulk of a log (permission.requested lines reach 500 KB,
// hook.*, model.*, session.usage_record), so cached logs stay small. A
// builder that starts reading another type must add it here.
const EVENT_TYPES_USED = new Set([
  "user.message",
  "assistant.turn_start",
  "assistant.message",
  "tool.execution_start",
  "tool.execution_complete",
  "permission.completed",
  "abort",
  "system.message",
  "session.shutdown",
  "session.compaction_start",
  "session.binary_asset",
]);

export function isAgentHostEventTypeUsed(type: string): boolean {
  return EVENT_TYPES_USED.has(type);
}

// The session's Copilot CLI event log as the source found it. A read log
// comes with session.db's turn join keys (rowid order), so the builder can
// cut it into turns; the other states carry the reason shown to the user.
export type AgentHostEventLog =
  | { status: "read"; events: CopilotEvent[]; turnRefs: AgentHostTurnEventRef[] }
  | { status: "missing" | "unreadable"; reason: string };

export interface AgentHostSessionInput {
  catalogRow: AgentHostSessionRow;
  store: AgentHostSessionStoreContents | null;
  // Omitted when the log wasn't opened: the list never opens it.
  eventLog?: AgentHostEventLog;
}

function known(value: number): TokenCount {
  return { known: true, value };
}

export function buildAgentHostTurnUsage(usage: AgentHostTurnUsage | null): TurnUsage {
  const notRecorded = unavailableTokenCount(AGENT_HOST_FIELD_NOT_RECORDED_REASON);
  const noTokens = unavailableTokenCount(AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON);
  const tokens = usage?.tokens ?? null;
  const nanoAiu = usage?.nanoAiu ?? null;
  return {
    // The Agent Host's input count includes the cache hits.
    uncachedInput: tokens ? known(Math.max(tokens.input - tokens.cached, 0)) : noTokens,
    cacheWrite: notRecorded,
    cacheRead: tokens ? known(tokens.cached) : noTokens,
    tool: notRecorded,
    vision: notRecorded,
    reasoning: notRecorded,
    output: tokens ? known(tokens.output) : noTokens,
    costAiCredits:
      nanoAiu === null ? unavailableTokenCount(AGENT_HOST_TURN_COST_UNAVAILABLE_REASON) : known(nanoAiuToAiCredits(nanoAiu)),
    model: usage?.model ?? UNKNOWN_MODEL,
  };
}

// How each turn's text and tool calls were found: from the log, unknown for
// a stated reason, or not looked up at all.
type TurnContentSource =
  | { kind: "content"; content: AgentHostTurnContent }
  | { kind: "unavailable"; note: string };

function buildExplanation(row: AgentHostTurnRow, usage: TurnUsage, note: string | undefined): string {
  const tokens = row.usage?.tokens ? buildAnalyzeExplanation(usage) : AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON;
  return note ? `${tokens} ${note}` : tokens;
}

function buildTurn(row: AgentHostTurnRow, index: number, source: TurnContentSource): Turn {
  const usage = buildAgentHostTurnUsage(row.usage);
  if (source.kind === "unavailable") {
    return { index, userMessage: "", assistantResponse: "", toolCalls: [], usage, explanation: buildExplanation(row, usage, source.note) };
  }
  const { content } = source;
  return {
    index,
    userMessage: content.userMessage,
    assistantResponse: content.assistantResponse,
    toolCalls: content.toolCalls,
    usage,
    explanation: buildExplanation(row, usage, content.textUnavailableReason),
    ...(content.textUnavailableReason ? { textUnavailableReason: content.textUnavailableReason } : {}),
    ...(content.toolCallsUnavailableReason ? { toolCallsUnavailableReason: content.toolCallsUnavailableReason } : {}),
  };
}

// The log cut into session.db's turns, keyed by turn id so the usage rows
// and the join keys pair up whatever their order.
function segmentedTurnsById(log: Extract<AgentHostEventLog, { status: "read" }>): Map<string, SegmentedTurn> {
  const { turns } = segmentCopilotTurns(log.events, log.turnRefs);
  return new Map(turns.map((turn) => [turn.turnId, turn]));
}

function turnContentSources(rows: AgentHostTurnRow[], eventLog: AgentHostEventLog | undefined): TurnContentSource[] {
  if (eventLog === undefined) {
    return rows.map(() => ({ kind: "unavailable", note: AGENT_HOST_TURN_TEXT_UNAVAILABLE_NOTE }));
  }
  if (eventLog.status !== "read") {
    return rows.map(() => ({ kind: "unavailable", note: eventLog.reason }));
  }
  const segmented = segmentedTurnsById(eventLog);
  // Over the whole log: a steering message splits a turn, so a call can
  // complete in the next turn's events.
  const outcomes = indexToolOutcomeEvents(eventLog.events);
  return rows.map((row) => {
    const turn = segmented.get(row.turnId) ?? { turnId: row.turnId, matched: false, reason: TURN_EVENT_NOT_FOUND_REASON };
    const content = turn.matched ? buildAgentHostTurnContent(turn, { outcomes }) : buildUnmatchedAgentHostTurnContent(turn);
    return { kind: "content", content };
  });
}

function eventLogStatus(eventLog: AgentHostEventLog): CopilotEventLogStatus {
  return eventLog.status === "read" ? { status: "read" } : { status: eventLog.status, reason: eventLog.reason };
}

function hasUsageRecord(row: AgentHostTurnRow): boolean {
  return row.usage !== null && (row.usage.tokens !== null || row.usage.nanoAiu !== null);
}

function lastTurnModel(rows: AgentHostTurnRow[]): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const model = rows[i].usage?.model;
    if (model) {
      return model;
    }
  }
  return null;
}

// An invalid Date throws from toISOString, and a session without a start is
// still listable (startedAt is optional in the domain).
function isoStart(startedAtMs: number): string | undefined {
  return Number.isFinite(startedAtMs) ? new Date(startedAtMs).toISOString() : undefined;
}

// All-or-nothing like the classic path (constraint 6), and unknown rather
// than 0 when there's nothing to sum, as computeSessionCost does.
function sessionCost(store: AgentHostSessionStoreContents | null, turns: Turn[]): TokenCount {
  if (store === null) {
    return unavailableTokenCount(AGENT_HOST_SESSION_DB_MISSING_REASON);
  }
  if (turns.length === 0) {
    return unavailableTokenCount(AGENT_HOST_NO_TURNS_REASON);
  }
  return sumTokenCounts(
    turns.map((built) => built.usage.costAiCredits),
    AGENT_HOST_SESSION_COST_UNAVAILABLE_REASON,
  );
}

// No providerId: the provider that lists the session stamps its own.
export function buildAgentHostSession({ catalogRow, store, eventLog }: AgentHostSessionInput): Session {
  const rows = store?.turns ?? [];
  const sources = turnContentSources(rows, eventLog);
  const turns = rows.map((row, index) => buildTurn(row, index, sources[index]!));
  const startedAt = isoStart(catalogRow.startedAtMs);
  // The Tools tab stays unset: the log records no tool definitions (owner, 2026-10-29).
  const systemPrompt = eventLog?.status === "read" ? buildAgentHostSystemPrompt(eventLog.events)?.components : undefined;
  return {
    id: catalogRow.id,
    mode: "analyze",
    title: store?.title ?? catalogRow.title ?? fallbackSessionTitle(catalogRow.id),
    model: store?.model ?? lastTurnModel(rows) ?? UNKNOWN_MODEL,
    turns,
    turnCount: turns.length,
    costAiCredits: sessionCost(store, turns),
    usageDataAvailable: rows.some(hasUsageRecord),
    copilotHarness: "agent-host",
    ...(eventLog ? { copilotEventLog: eventLogStatus(eventLog) } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(startedAt ? { startedAt } : {}),
  };
}

// The list's summary (turns: [], the GET /api/sessions contract). The turns
// are read anyway for the session's AI Credits, so the rest is exact.
export function buildAgentHostSessionSummary(input: AgentHostSessionInput): Session {
  return { ...buildAgentHostSession(input), turns: [] };
}

// One turn's inspector rounds, by its session.db index (the caller checks
// the index exists). Unknown rounds are never an empty list that reads as
// "no requests" (constraint 6): they carry the reason instead.
export function buildAgentHostTurnDetail(turnIndex: number, eventLog: AgentHostEventLog): TurnInspectorDetail {
  const unavailable = (reason: string): TurnInspectorDetail => ({ turnIndex, userMessage: [], rounds: [], unavailableReason: reason });
  if (eventLog.status !== "read") {
    return unavailable(eventLog.reason);
  }
  const turn = segmentCopilotTurns(eventLog.events, eventLog.turnRefs).turns[turnIndex];
  if (!turn) {
    return unavailable(TURN_EVENT_NOT_FOUND_REASON);
  }
  return turn.matched ? buildAgentHostTurnInspector(turnIndex, turn) : unavailable(turn.reason);
}
