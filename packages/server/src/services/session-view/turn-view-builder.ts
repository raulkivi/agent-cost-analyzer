import { MAX_EVIDENCE_EXCERPT_LENGTH, type Session, type ToolCallRecord, type TurnView } from "@agent-cost-analyzer/domain";
import { turnTextUnavailableReason, turnToolCallsUnavailableReason } from "../tool-audit/tool-calls-availability.js";
import { statusOf } from "../tool-audit/outcome-tally.js";
import { excerptOf, redactSecrets } from "../tool-audit/output-redactor.js";
import { resolveToolKind } from "../tool-audit/tool-kind-resolver.js";

// Phase 9.12 (docs/plans/mcp-tools-v2.md §4/§6): one turn for the MCP
// get_turn tool. Everything returned enters the client model's context, so
// free text is redacted and then bounded. Pure.

export const DEFAULT_MAX_TEXT_CHARS = 2000;

export interface TurnViewOptions {
  maxTextChars?: number;
}

function bounded(text: string, maxChars: number): { text: string; truncated: boolean } {
  const redacted = redactSecrets(text);
  return redacted.length <= maxChars
    ? { text: redacted, truncated: false }
    : { text: `${redacted.slice(0, maxChars - 1)}…`, truncated: true };
}

function compactCall(call: ToolCallRecord): TurnView["toolCalls"][number] {
  const commandText = call.shell?.command ?? call.argsSummary;
  const command = commandText ? excerptOf(commandText, MAX_EVIDENCE_EXCERPT_LENGTH) : "";
  const { failureCategory, exitCode } = call.outcome ?? {};
  return {
    name: call.name,
    kind: call.kind ?? resolveToolKind(call.name),
    status: statusOf(call),
    ...(failureCategory ? { failureCategory } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(command ? { command } : {}),
    ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
  };
}

export function buildTurnView(session: Session, turnIndex: number, options: TurnViewOptions = {}): TurnView | null {
  const turn = session.turns.find((candidate) => candidate.index === turnIndex);
  if (!turn) {
    return null;
  }
  const maxChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  const textReason = turnTextUnavailableReason(session, turn);
  const callsReason = turnToolCallsUnavailableReason(session, turn);
  const user = bounded(turn.userMessage, maxChars);
  const assistant = bounded(turn.assistantResponse, maxChars);
  return {
    sessionId: session.id,
    ...(session.providerId ? { providerId: session.providerId } : {}),
    turnIndex,
    turnCount: session.turns.length,
    model: turn.usage.model,
    ...(turn.triggeredEvent ? { triggeredEvent: turn.triggeredEvent } : {}),
    userMessage: user.text,
    userMessageTruncated: user.truncated,
    assistantResponse: assistant.text,
    assistantResponseTruncated: assistant.truncated,
    explanation: bounded(turn.explanation, maxChars).text,
    usage: turn.usage,
    toolCalls: turn.toolCalls.map(compactCall),
    ...(textReason ? { textUnavailableReason: textReason } : {}),
    ...(callsReason ? { toolCallsUnavailableReason: callsReason } : {}),
  };
}
