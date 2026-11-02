import type { ToolCallRecord, ToolCallStatus } from "@agent-cost-analyzer/domain";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import { MAX_ARGS_SUMMARY_LENGTH, summarizeToolArgs } from "../tool-audit/args-summary.js";
import { buildToolCallOutcome } from "../tool-audit/outcome-builder.js";
import { excerptOf } from "../tool-audit/output-redactor.js";
import { parseShellCommand } from "../tool-audit/shell-command-parser.js";
import { resolveToolKind } from "../tool-audit/tool-kind-resolver.js";
import { isSubagentEvent, type MatchedTurn, type UnmatchedTurn } from "./copilot-turn-segmenter.js";

// Turn text and tool calls with outcomes for an Agent Host turn, from the
// Copilot CLI event log (vscode-extension.md step 10.14, architecture.md
// §6.2.2.2). Pure: takes the segmenter's output, does no I/O.

export interface AgentHostTurnContent {
  userMessage: string;
  assistantResponse: string;
  toolCalls: ToolCallRecord[];
  // Set only for an unmatched turn: the text and tool calls are unknown,
  // not empty (constraint 6). The Turn shape has no field for it, so the
  // wiring carries these into the session's unavailability markers.
  textUnavailableReason?: string;
  toolCallsUnavailableReason?: string;
}

// What closes a tool call, indexed by toolCallId. A call can start in one
// turn and complete in the next (a steering message splits the turn), so the
// wiring may pass an index over the whole log.
export interface ToolOutcomeIndex {
  completes: Map<string, CopilotEvent>;
  permissions: Map<string, CopilotEvent>;
}

export interface BuildTurnContentOptions {
  // Defaults to an index over the turn's own events.
  outcomes?: ToolOutcomeIndex;
}

const APPROVED_KINDS = new Set(["approved", "approved-for-location"]);
export const NO_COMPLETION_REASON =
  "The Copilot CLI event log has no completion for this call, and the turn was not aborted, so its outcome is unknown.";
const INTERRUPTED_TEXT = "The turn was aborted before this call completed.";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

// Later events win: a re-issued completion or permission supersedes the first.
export function indexToolOutcomeEvents(events: readonly CopilotEvent[]): ToolOutcomeIndex {
  const index: ToolOutcomeIndex = { completes: new Map(), permissions: new Map() };
  for (const event of events) {
    const id = str(event.data.toolCallId);
    if (!id) continue;
    if (event.type === "tool.execution_complete") index.completes.set(id, event);
    else if (event.type === "permission.completed") index.permissions.set(id, event);
  }
  return index;
}

interface CallDraft {
  id: string;
  name: string;
  args: unknown;
  startedAt?: string;
  agentId: string | null;
  parentToolCallId?: string;
  // Main-agent round of the call itself; subagent calls take their parent's.
  ownRound?: number;
  startTimestamp?: string;
}

// Main-agent rounds are counted by assistant.turn_start; events before the
// first one belong to round 0.
function collectCalls(events: readonly CopilotEvent[]): CallDraft[] {
  const drafts = new Map<string, CallDraft>();
  let round = -1;
  const touch = (id: string, event: CopilotEvent, name: string, args: unknown): CallDraft => {
    const draft = drafts.get(id) ?? { id, name, args, agentId: event.agentId };
    drafts.set(id, draft);
    return draft;
  };
  for (const event of events) {
    const main = !isSubagentEvent(event);
    if (event.type === "assistant.turn_start" && main) round++;
    if (event.type === "assistant.message") {
      const requests = Array.isArray(event.data.toolRequests) ? event.data.toolRequests : [];
      for (const request of requests) {
        const r = obj(request);
        const id = str(r?.toolCallId);
        if (!r || !id || drafts.has(id)) continue;
        const draft = touch(id, event, str(r.name) ?? "unknown", r.arguments);
        draft.startedAt = event.timestamp ?? undefined;
        if (main) draft.ownRound = Math.max(round, 0);
      }
    } else if (event.type === "tool.execution_start") {
      const id = str(event.data.toolCallId);
      if (!id) continue;
      const draft = touch(id, event, str(event.data.toolName) ?? "unknown", event.data.arguments);
      draft.name = str(event.data.toolName) ?? draft.name;
      draft.args = event.data.arguments ?? draft.args;
      draft.startTimestamp = event.timestamp ?? undefined;
      draft.startedAt = event.timestamp ?? draft.startedAt;
      draft.agentId = event.agentId;
      draft.parentToolCallId = str(event.data.parentToolCallId) ?? draft.parentToolCallId;
      if (main && draft.ownRound === undefined) draft.ownRound = Math.max(round, 0);
    }
  }
  return [...drafts.values()];
}

// A subagent's call counts in the round of the main-agent call that started
// it (following parentToolCallId up, as subagents can nest); undefined when
// that chain doesn't reach a main-agent call.
function roundOf(draft: CallDraft, byId: Map<string, CallDraft>): number | undefined {
  const seen = new Set<string>();
  let current: CallDraft | undefined = draft;
  while (current && !seen.has(current.id)) {
    if (current.ownRound !== undefined) return current.ownRound;
    seen.add(current.id);
    current = current.parentToolCallId ? byId.get(current.parentToolCallId) : undefined;
  }
  return undefined;
}

function durationBetween(start: string | null | undefined, end: string | null): number | undefined {
  if (!start || !end) return undefined;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

function pathOf(args: unknown): string | undefined {
  const a = obj(args);
  return a ? (str(a.path) ?? str(a.file_path) ?? str(a.filePath)) : undefined;
}

function filesTouchedOf(kind: string, args: unknown, complete: CopilotEvent | undefined): string[] {
  const edits = Array.isArray(complete?.data.fileEdits) ? complete.data.fileEdits : [];
  const paths = edits.map((e) => str(obj(e)?.path)).filter((p): p is string => p !== undefined);
  if (paths.length > 0) return paths;
  const arg = kind === "file-read" || kind === "file-write" ? pathOf(args) : undefined;
  return arg ? [arg] : [];
}

function outcomeOf(
  kind: ReturnType<typeof resolveToolKind>,
  permission: CopilotEvent | undefined,
  complete: CopilotEvent | undefined,
  aborted: boolean,
): ToolCallRecord["outcome"] {
  const permissionKind = str(obj(permission?.data.result)?.kind);
  // Checked first: a refused call may still have a start event, and the
  // refusal, not the abort that followed, is why it didn't run.
  if (permission && permissionKind !== undefined && !APPROVED_KINDS.has(permissionKind)) {
    const feedback = str(obj(permission.data.result)?.feedback);
    return buildToolCallOutcome({
      kind,
      status: "denied",
      text: `Permission ${permissionKind}.${feedback ? ` ${feedback}` : ""}`,
    });
  }
  if (complete) {
    const exit = obj(complete.data.shellExecution)?.exitCode;
    const exitCode = typeof exit === "number" && Number.isInteger(exit) ? { exitCode: exit } : {};
    const status: ToolCallStatus = complete.data.success === true ? "success" : "error";
    const text = str(obj(complete.data.error)?.message) ?? "";
    return buildToolCallOutcome({ kind, status, text, ...exitCode });
  }
  return aborted
    ? buildToolCallOutcome({ kind, status: "interrupted", text: INTERRUPTED_TEXT })
    : buildToolCallOutcome({ kind, status: "unknown", text: "", reason: NO_COMPLETION_REASON });
}

function buildRecord(
  draft: CallDraft,
  roundIndex: number | undefined,
  outcomes: ToolOutcomeIndex,
  aborted: boolean,
): ToolCallRecord {
  const kind = resolveToolKind(draft.name);
  const complete = outcomes.completes.get(draft.id);
  const command = kind === "shell" ? str(obj(draft.args)?.command) : undefined;
  const parsed = command !== undefined ? parseShellCommand(command) : undefined;
  const durationMs = durationBetween(draft.startTimestamp, complete?.timestamp ?? null);
  const filesTouched = filesTouchedOf(kind, draft.args, complete);
  return {
    id: draft.id,
    name: draft.name,
    kind,
    argsSummary: summarizeToolArgs(kind, draft.args),
    ...(command !== undefined
      ? { shell: { command: excerptOf(command, MAX_ARGS_SUMMARY_LENGTH), ...(parsed?.program ? { program: parsed.program } : {}) } }
      : {}),
    outcome: outcomeOf(kind, outcomes.permissions.get(draft.id), complete, aborted),
    ...(draft.startedAt ? { startedAt: draft.startedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(roundIndex !== undefined ? { roundIndex } : {}),
    ...(filesTouched.length > 0 ? { filesTouched } : {}),
  };
}

// Like the Claude Code and pi providers, the response is the last round's
// text (earlier rounds are commentary on the way to tool calls). Subagent
// messages are never the answer.
function assistantResponseOf(events: readonly CopilotEvent[]): string {
  let texts: string[] = [];
  for (const event of events) {
    if (isSubagentEvent(event)) continue;
    if (event.type === "assistant.turn_start") texts = [];
    else if (event.type === "assistant.message") {
      const content = str(event.data.content);
      if (content !== undefined) texts.push(content);
    }
  }
  return texts.join("\n");
}

export function buildAgentHostTurnContent(turn: MatchedTurn, options: BuildTurnContentOptions = {}): AgentHostTurnContent {
  const outcomes = options.outcomes ?? indexToolOutcomeEvents(turn.events);
  const aborted = turn.events.some((e) => e.type === "abort");
  const drafts = collectCalls(turn.events);
  const byId = new Map(drafts.map((d) => [d.id, d]));
  return {
    userMessage: str(turn.userMessage.data.content) ?? "",
    assistantResponse: assistantResponseOf(turn.events),
    toolCalls: drafts.map((d) => buildRecord(d, roundOf(d, byId), outcomes, aborted)),
  };
}

// Unknown, never empty-as-zero (constraint 6): the empty text and list are
// placeholders and the reasons say so.
export function buildUnmatchedAgentHostTurnContent(turn: UnmatchedTurn): AgentHostTurnContent {
  return {
    userMessage: "",
    assistantResponse: "",
    toolCalls: [],
    textUnavailableReason: turn.reason,
    toolCallsUnavailableReason: turn.reason,
  };
}
