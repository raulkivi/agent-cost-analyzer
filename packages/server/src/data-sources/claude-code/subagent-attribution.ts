// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { subagentRunIdSchema, unavailableTokenCount, type SubagentRunUsage } from "@agent-cost-analyzer/domain";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { logTurnAt } from "../jsonl/subagent-attribution.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";
import { agentCallIdsOf, agentCallsIn, type AgentCall } from "./subagent-call-index.js";
import type { SubagentMeta } from "./subagent-meta.js";
import { extractClaudeCodeRunUsage, subagentLabelOf, type ClaudeCodeRunUsageResult } from "./subagent-run-usage.js";

// Plain sentences: each reaches the UI and the MCP tools as the reason a run's,
// a turn's or a session's figures are unknown. None embeds log text.
export const SUBAGENT_TRANSCRIPT_MISSING_REASON = "The subagent transcript this turn started is missing.";
export const SUBAGENT_TRANSCRIPT_NOT_REGULAR_REASON =
  "A subagent transcript in this session's folder is not a regular file (for example a symbolic link), so it was not read.";
export const SUBAGENT_TRANSCRIPT_UNREADABLE_REASON =
  "A subagent transcript could not be read, so the usage of the run it holds is unknown.";
export const SUBAGENT_FOLDER_NOT_REGULAR_REASON =
  "This session's subagents folder is not a regular folder (for example a symbolic link), so no subagent transcript was read.";
export const SUBAGENT_FOLDER_UNREADABLE_REASON =
  "This session's subagents folder could not be listed, so subagent runs in it may have been left out.";
export const SUBAGENT_TOO_MANY_REASON =
  "This session's folder has too many subagent transcripts to read, so its subagent usage is unknown.";
export const SUBAGENT_NESTING_TOO_DEEP_REASON = "nested subagents beyond the read depth";
export const SUBAGENT_UNMATCHED_REASON =
  "A subagent transcript in this session's folder could not be matched to a turn.";
export const SUBAGENT_COUNTED_ELSEWHERE_NOTE = "A subagent run this turn started is counted in another session.";

/** A chain of nested runs longer than this is unknown (plan section 5.4, step 3). */
export const MAX_CLAUDE_CODE_RUN_DEPTH = 8;

export type ClaudeCodeRunTranscript =
  | { status: "read"; entries: ClaudeCodeRawEntry[] }
  /** Meta only, or the listing never saw the file. */
  | { status: "missing" }
  /** A valid name whose entry is a symlink or directory. */
  | { status: "not-regular-file" }
  | { status: "unreadable" };

/** One run of a session's folder, as the provider read it (no file handles here). */
export interface ClaudeCodeRunInput {
  /** From the file name, never from log content. */
  agentId: string;
  /** Absent when there is no meta file or it was malformed or too large. */
  meta?: SubagentMeta;
  transcript: ClaudeCodeRunTranscript;
}

export type ClaudeCodeSubagentFolder =
  | { status: "ok" }
  | { status: "unusable"; reason: "not-regular-folder" | "too-many" | "unreadable" };

export interface ClaudeCodeAttributionInput {
  runs: readonly ClaudeCodeRunInput[];
  folder: ClaudeCodeSubagentFolder;
  /** The active branch, root to leaf. */
  branch: readonly ClaudeCodeRawEntry[];
  /** The branch grouped into turns; a turn index is a position in this list. */
  turnGroups: readonly ClaudeCodeTurnGroup[];
  /** Every line of the session file, to tell an off-branch call from an unknown one (D5). */
  sessionEntries: readonly ClaudeCodeRawEntry[];
  /**
   * Call ids and agent ids whose run another session's folder in the same
   * project holds (D7). The caller found them; this module reads no folder.
   */
  countedInOtherSessions?: ReadonlySet<string>;
}

export interface ClaudeCodeTurnRuns {
  /**
   * In start order. A run may carry unknown figures: merging it makes the
   * turn unknown, so no known total can leave its rounds out.
   */
  runs: SubagentRunUsage[];
  notes: string[];
}

export interface ClaudeCodeSubagentAttribution {
  byTurn: Map<number, ClaudeCodeTurnRuns>;
  /**
   * Distinct reasons, in the order found. Empty exactly when every run was
   * read, placed and has known tokens: only then may the session's tokens be
   * known (constraint 6). `costAiCredits` is always unknown and never a reason.
   */
  sessionUnknownReasons: string[];
  /** Runs whose `Agent` call is off the active branch (D5): not counted, kept for the oracle. */
  offBranchRunIds: string[];
}

type Attribution = SubagentRunUsage["attribution"];

type Placement =
  | { kind: "turn"; turn: number; attribution: Attribution; callId?: string; ancestors: string[] }
  | { kind: "off-branch" }
  | { kind: "cycle" }
  | { kind: "unmatched"; reason: string };

// The fields a round can be left out of. `reasoning` is a part of `output`
// and `extendedCacheWrite` a part of `cacheWrite`: an unknown part leaves no
// round out, so it is no reason to make the session unknown.
const TOKEN_FIELDS = ["uncachedInput", "cacheWrite", "cacheRead", "output"] as const;

const FOLDER_REASONS = {
  "not-regular-folder": SUBAGENT_FOLDER_NOT_REGULAR_REASON,
  "too-many": SUBAGENT_TOO_MANY_REASON,
  unreadable: SUBAGENT_FOLDER_UNREADABLE_REASON,
} as const;

function unknownRun(
  fields: { id: string; label: string; attribution: Attribution; reason: string } & Partial<
    Pick<SubagentRunUsage, "parentRunId" | "startedAt">
  >,
): SubagentRunUsage {
  const unknown = unavailableTokenCount(fields.reason);
  return {
    id: fields.id,
    label: fields.label,
    model: "unknown",
    roundsCount: 0,
    uncachedInput: unknown,
    cacheWrite: unknown,
    cacheRead: unknown,
    reasoning: unknown,
    output: unknown,
    extendedCacheWrite: unknown,
    costAiCredits: unknown,
    attribution: fields.attribution,
    ...(fields.parentRunId === undefined ? {} : { parentRunId: fields.parentRunId }),
    ...(fields.startedAt === undefined ? {} : { startedAt: fields.startedAt }),
  };
}

// Why a transcript yields no figures, or undefined when it can be summed. A
// file with 0 parsable lines is no run with 0 tokens: it is unreadable.
function transcriptProblem(transcript: ClaudeCodeRunTranscript): string | undefined {
  switch (transcript.status) {
    case "missing":
      return SUBAGENT_TRANSCRIPT_MISSING_REASON;
    case "not-regular-file":
      return SUBAGENT_TRANSCRIPT_NOT_REGULAR_REASON;
    case "unreadable":
      return SUBAGENT_TRANSCRIPT_UNREADABLE_REASON;
    case "read":
      return transcript.entries.length === 0 ? SUBAGENT_TRANSCRIPT_UNREADABLE_REASON : undefined;
  }
}

function messageIdsAndRequestIds(entries: readonly ClaudeCodeRawEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    const id = (entry.message as { id?: unknown } | undefined)?.id;
    if (typeof id === "string") ids.add(id);
    if (typeof entry.requestId === "string") ids.add(entry.requestId);
  }
  return ids;
}

function firstTimestampMs(entries: readonly ClaudeCodeRawEntry[]): number {
  for (const entry of entries) {
    if (typeof entry.timestamp !== "string") continue;
    const ms = Date.parse(entry.timestamp);
    if (!Number.isNaN(ms)) return ms;
  }
  return Number.NaN;
}

function turnStartMs(group: ClaudeCodeTurnGroup): number | null {
  const timestamp = group.userMessageEntry.timestamp;
  const ms = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
  return Number.isNaN(ms) ? null : ms;
}

const startedAtMs = (run: SubagentRunUsage): number =>
  run.startedAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(run.startedAt);

// Collects the result; every unknown is also a session reason, so no caller
// can lose one between turn placement and the session total.
class AttributionBuilder {
  private readonly byTurn = new Map<number, ClaudeCodeTurnRuns>();
  private readonly reasons = new Set<string>();
  private readonly offBranch: string[] = [];

  private turn(index: number): ClaudeCodeTurnRuns {
    let entry = this.byTurn.get(index);
    if (entry === undefined) {
      entry = { runs: [], notes: [] };
      this.byTurn.set(index, entry);
    }
    return entry;
  }

  place(turn: number, run: SubagentRunUsage): void {
    this.turn(turn).runs.push(run);
    for (const field of TOKEN_FIELDS) {
      const count = run[field];
      if (!count.known) this.reasons.add(count.reason);
    }
  }

  note(turn: number, note: string): void {
    this.turn(turn).notes.push(note);
  }

  sessionUnknown(reason: string): void {
    this.reasons.add(reason);
  }

  offBranchRun(agentId: string): void {
    this.offBranch.push(agentId);
  }

  build(): ClaudeCodeSubagentAttribution {
    for (const entry of this.byTurn.values()) {
      entry.runs.sort((a, b) => startedAtMs(a) - startedAtMs(b) || a.id.localeCompare(b.id));
    }
    return { byTurn: this.byTurn, sessionUnknownReasons: [...this.reasons], offBranchRunIds: this.offBranch };
  }
}

// What the parent's own lines say about `Agent` calls, by the two links a run
// can have (its meta's toolUseId, and the call's result naming its agentId).
class CallLinks {
  readonly onBranch: Map<string, AgentCall>;
  readonly turnOfCall = new Map<string, number>();
  private readonly callOfAgent = new Map<string, string>();
  private readonly offBranchCalls = new Set<string>();
  private readonly offBranchAgents = new Set<string>();

  constructor(input: ClaudeCodeAttributionInput) {
    this.onBranch = agentCallsIn(input.branch);
    input.turnGroups.forEach((group, turn) => {
      for (const callId of agentCallIdsOf(group.entries)) this.turnOfCall.set(callId, turn);
    });
    for (const call of this.onBranch.values()) {
      if (call.agentId !== undefined) this.callOfAgent.set(call.agentId, call.callId);
    }
    for (const call of agentCallsIn(input.sessionEntries).values()) {
      if (this.onBranch.has(call.callId)) continue;
      this.offBranchCalls.add(call.callId);
      if (call.agentId !== undefined) this.offBranchAgents.add(call.agentId);
    }
  }

  /** The turn-placed or off-branch link of a run, or undefined when no call names it. */
  of(run: ClaudeCodeRunInput): Placement | undefined {
    const toolUseId = run.meta?.toolUseId;
    const callId =
      toolUseId !== undefined && this.turnOfCall.has(toolUseId) ? toolUseId : this.callOfAgent.get(run.agentId);
    const turn = callId === undefined ? undefined : this.turnOfCall.get(callId);
    if (callId !== undefined && turn !== undefined) return { kind: "turn", turn, attribution: "tool-use-id", callId, ancestors: [] };
    if ((toolUseId !== undefined && this.offBranchCalls.has(toolUseId)) || this.offBranchAgents.has(run.agentId)) {
      return { kind: "off-branch" };
    }
    return undefined;
  }
}

class RunPlacer {
  private readonly byId: Map<string, ClaudeCodeRunInput>;
  private readonly memo = new Map<string, Placement>();
  private readonly turnStarts: (number | null)[];

  constructor(
    private readonly runs: readonly ClaudeCodeRunInput[],
    private readonly links: CallLinks,
    turnGroups: readonly ClaudeCodeTurnGroup[],
  ) {
    this.byId = new Map(runs.map((run) => [run.agentId, run]));
    this.turnStarts = turnGroups.map(turnStartMs);
  }

  // Plan section 5.4, step 3: the parent's call (meta, then the result's
  // agentId), else the parent run's placement, else the time of its first line.
  placementOf(run: ClaudeCodeRunInput, path: ReadonlySet<string> = new Set()): Placement {
    const cached = this.memo.get(run.agentId);
    if (cached !== undefined) return cached;

    const placement = this.links.of(run) ?? this.viaParent(run, path) ?? this.byTime(run);
    this.memo.set(run.agentId, placement);
    return placement;
  }

  private viaParent(run: ClaudeCodeRunInput, path: ReadonlySet<string>): Placement | undefined {
    const parentId = run.meta?.parentAgentId;
    const parent = parentId === undefined ? undefined : this.byId.get(parentId);
    if (parentId === undefined || parent === undefined) return undefined;
    if (parentId === run.agentId || path.has(parentId)) return { kind: "cycle" };

    const placement = this.placementOf(parent, new Set([...path, run.agentId]));
    return placement.kind === "turn"
      ? { ...placement, callId: undefined, ancestors: [parentId, ...placement.ancestors] }
      : placement;
  }

  // D6: a run nothing names is matched by the time of its first line, but only
  // when exactly one turn's window holds it.
  private byTime(run: ClaudeCodeRunInput): Placement {
    const problem = transcriptProblem(run.transcript);
    if (problem !== undefined) return { kind: "unmatched", reason: problem };
    const entries = run.transcript.status === "read" ? run.transcript.entries : [];
    const start = firstTimestampMs(entries);
    const turn = Number.isNaN(start) ? null : logTurnAt(this.turnStarts, start);
    return turn === null
      ? { kind: "unmatched", reason: SUBAGENT_UNMATCHED_REASON }
      : { kind: "turn", turn, attribution: "timestamp", ancestors: [] };
  }
}

// A run's own figures from its transcript, or an unknown run saying why not.
function runFor(
  run: ClaudeCodeRunInput,
  placement: Extract<Placement, { kind: "turn" }>,
  parentRequestIds: ReadonlySet<string>,
): { usage: SubagentRunUsage; requestIds?: ClaudeCodeRunUsageResult["requestIds"] } {
  const meta = run.meta ?? {};
  const unknown = (reason: string): SubagentRunUsage =>
    unknownRun({
      id: run.agentId,
      label: subagentLabelOf(meta),
      attribution: placement.attribution,
      reason,
      parentRunId: meta.parentAgentId,
    });

  if (placement.ancestors.length + 1 > MAX_CLAUDE_CODE_RUN_DEPTH) return { usage: unknown(SUBAGENT_NESTING_TOO_DEEP_REASON) };
  const problem = transcriptProblem(run.transcript);
  if (problem !== undefined || run.transcript.status !== "read") return { usage: unknown(problem ?? SUBAGENT_TRANSCRIPT_UNREADABLE_REASON) };

  const { usage, requestIds } = extractClaudeCodeRunUsage(run.transcript.entries, meta, parentRequestIds);
  return { usage: { ...usage, id: usage.id ?? run.agentId, attribution: placement.attribution }, requestIds };
}

function placeCalls(
  input: ClaudeCodeAttributionInput,
  links: CallLinks,
  claimed: ReadonlySet<string>,
  builder: AttributionBuilder,
  reasonFor: (call: AgentCall) => string | undefined,
): void {
  let counter = 0;
  for (const call of links.onBranch.values()) {
    const turn = links.turnOfCall.get(call.callId);
    if (turn === undefined || call.failed || claimed.has(call.callId)) continue; // D8: a failed launch is no run

    const elsewhere = input.countedInOtherSessions;
    if (elsewhere !== undefined && (elsewhere.has(call.callId) || (call.agentId !== undefined && elsewhere.has(call.agentId)))) {
      builder.note(turn, SUBAGENT_COUNTED_ELSEWHERE_NOTE); // D7
      continue;
    }

    const reason = reasonFor(call);
    if (reason === undefined) continue;
    counter += 1;
    const id = subagentRunIdSchema.safeParse(call.callId).success ? call.callId : `missing-run-${counter}`;
    builder.place(turn, unknownRun({ id, label: "Agent", attribution: "tool-use-id", reason }));
  }
}

/**
 * Places each of a Claude Code session's subagent runs on the turn whose
 * `Agent` call started it, and sums it (plan sections 5.4 and 6). Pure: it
 * takes parsed data, not file handles. Any run that cannot be read, placed or
 * summed leaves an unknown run on a turn or a session reason, never a lower
 * known total.
 */
export function attributeClaudeCodeRuns(input: ClaudeCodeAttributionInput): ClaudeCodeSubagentAttribution {
  const builder = new AttributionBuilder();
  const links = new CallLinks(input);

  if (input.folder.status === "unusable") {
    // Nothing was read, so every call that should have a run is missing it.
    const reason = FOLDER_REASONS[input.folder.reason];
    builder.sessionUnknown(reason);
    placeCalls(input, links, new Set(), builder, () => reason);
    return builder.build();
  }

  const placer = new RunPlacer(input.runs, links, input.turnGroups);
  const placed: { run: ClaudeCodeRunInput; placement: Extract<Placement, { kind: "turn" }> }[] = [];
  for (const run of input.runs) {
    const placement = placer.placementOf(run);
    if (placement.kind === "turn") placed.push({ run, placement });
    else if (placement.kind === "off-branch") builder.offBranchRun(run.agentId); // D5: not counted
    else builder.sessionUnknown(placement.kind === "cycle" ? SUBAGENT_NESTING_TOO_DEEP_REASON : placement.reason);
  }

  // Ancestors first: a nested fork repeats rounds of every run above it, so its
  // skip set is the main session's rounds plus each ancestor run's counted ones
  // (plan section 13.2), which only exist once those runs are summed.
  const requestIdsOf = new Map<string, ReadonlySet<string>>();
  const sessionIds = messageIdsAndRequestIds(input.branch);
  const claimed = new Set<string>();
  for (const { run, placement } of [...placed].sort((a, b) => a.placement.ancestors.length - b.placement.ancestors.length)) {
    const skip = new Set(sessionIds);
    for (const ancestorId of placement.ancestors) {
      for (const id of requestIdsOf.get(ancestorId) ?? []) skip.add(id);
    }
    const { usage, requestIds } = runFor(run, placement, skip);
    if (requestIds !== undefined) requestIdsOf.set(run.agentId, requestIds);
    if (placement.callId !== undefined) claimed.add(placement.callId);
    builder.place(placement.turn, usage);
  }

  placeCalls(input, links, claimed, builder, () => SUBAGENT_TRANSCRIPT_MISSING_REASON);
  return builder.build();
}
