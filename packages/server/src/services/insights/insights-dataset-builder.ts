import type {
  InsightSessionRow,
  InsightToolCallRow,
  InsightTurnRow,
  Session,
  TokenCount,
  ToolCallRecord,
  Turn,
} from "@agent-cost-analyzer/domain";
import { MAX_EVIDENCE_EXCERPT_LENGTH } from "@agent-cost-analyzer/domain";
import { excerptOf } from "../tool-audit/output-redactor.js";
import { toolCallsUnavailableReason } from "../tool-audit/tool-calls-availability.js";
import { statusOf } from "../tool-audit/outcome-tally.js";
import { resolveToolKind } from "../tool-audit/tool-kind-resolver.js";

// Phase 9.11 (docs/plans/insights-dashboard.md §3/§4): pure flattening of
// normalized Sessions from every provider into the dashboard's star schema.

export interface ProviderSessions {
  providerId: string;
  providerLabel: string;
  sessions: Session[];
}

export interface InsightRows {
  sessions: InsightSessionRow[];
  turns: InsightTurnRow[];
  toolCalls: InsightToolCallRow[];
}

export function sessionKeyOf(providerId: string, sessionId: string): string {
  return `${providerId}:${sessionId}`;
}

export function turnKeyOf(sessionKey: string, turnIndex: number): string {
  return `${sessionKey}:${turnIndex}`;
}

export function toolCallKeyOf(turnKey: string, callIndex: number): string {
  return `${turnKey}:${callIndex}`;
}

// Unknown stays null (constraint 6) so the UI can report coverage.
function figure(count: TokenCount): number | null {
  return count.known ? count.value : null;
}

function isEstimated(count: TokenCount): boolean {
  return count.known && count.estimated === true;
}

function sessionRow(source: ProviderSessions, session: Session): InsightSessionRow {
  const startedAt = session.startedAt ? new Date(session.startedAt) : undefined;
  const validStart = startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : undefined;
  return {
    key: sessionKeyOf(source.providerId, session.id),
    providerId: source.providerId,
    providerLabel: source.providerLabel,
    sessionId: session.id,
    title: session.title,
    model: session.model,
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    ...(toolCallsUnavailableReason(session) ? { toolCallsUnavailable: true } : {}),
    ...(validStart ? { date: validStart.toISOString().slice(0, 10), hour: validStart.getUTCHours() } : {}),
  };
}

function turnRow(sessionKey: string, turn: Turn, toolCallsUnknown: boolean): InsightTurnRow {
  const { usage } = turn;
  const counts = [usage.uncachedInput, usage.cacheWrite, usage.cacheRead, usage.reasoning, usage.output, usage.costAiCredits];
  return {
    key: turnKeyOf(sessionKey, turn.index),
    sessionKey,
    turnIndex: turn.index,
    model: usage.model,
    ...(turn.triggeredEvent ? { triggeredEvent: turn.triggeredEvent } : {}),
    uncachedInput: figure(usage.uncachedInput),
    cacheWrite: figure(usage.cacheWrite),
    cacheRead: figure(usage.cacheRead),
    reasoning: figure(usage.reasoning),
    output: figure(usage.output),
    aiCredits: figure(usage.costAiCredits),
    estimated: counts.some(isEstimated),
    toolCallCount: toolCallsUnknown ? null : turn.toolCalls.length,
  };
}

function toolCallRow(turnKey: string, call: ToolCallRecord, callIndex: number): InsightToolCallRow {
  const commandText = call.shell?.command ?? call.argsSummary;
  const command = commandText ? excerptOf(commandText, MAX_EVIDENCE_EXCERPT_LENGTH) : "";
  const program = call.shell?.program;
  const failureCategory = call.outcome?.failureCategory;
  return {
    key: toolCallKeyOf(turnKey, callIndex),
    turnKey,
    name: call.name,
    kind: call.kind ?? resolveToolKind(call.name),
    ...(program ? { program } : {}),
    status: statusOf(call),
    ...(failureCategory ? { failureCategory } : {}),
    ...(command ? { command } : {}),
    ...(call.startedAt ? { startedAt: call.startedAt } : {}),
    ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
  };
}

export function buildInsightRows(sources: ProviderSessions[]): InsightRows {
  const rows: InsightRows = { sessions: [], turns: [], toolCalls: [] };
  for (const source of sources) {
    for (const session of source.sessions) {
      const sessionKey = sessionKeyOf(source.providerId, session.id);
      rows.sessions.push(sessionRow(source, session));
      for (const turn of session.turns) {
        const turnKey = turnKeyOf(sessionKey, turn.index);
        rows.turns.push(turnRow(sessionKey, turn, toolCallsUnavailableReason(session) !== undefined));
        turn.toolCalls.forEach((call, callIndex) => rows.toolCalls.push(toolCallRow(turnKey, call, callIndex)));
      }
    }
  }
  return rows;
}
