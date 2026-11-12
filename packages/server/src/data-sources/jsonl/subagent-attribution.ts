// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SubagentRunUsage } from "@agent-cost-analyzer/domain";
import type { ChildSessionRef } from "./child-session-refs.js";
import type { JsonlEnvelope, MainJsonlReadResult } from "./main-jsonl-reader.js";
import {
  MAX_SUBAGENT_FILES_PER_SESSION,
  type SubagentLogListing,
  type SubagentLogResolution,
} from "./subagent-log-path.js";
import { extractSubagentRunUsage, type SubagentRunIdentity } from "./subagent-run-usage.js";

// Plain sentences: each reaches the UI and the MCP tools as the reason a
// session's (or turn's) AI Credits are unknown. None embeds log text.
export const SUBAGENT_LOG_MISSING_REASON =
  "The log of a subagent run this session started is missing, so the AI Credits it used are unknown.";
export const SUBAGENT_LOG_NAME_REJECTED_REASON =
  "A subagent run's log reference is not a subagent log name, so its log was not read and the AI Credits it used are unknown.";
export const SUBAGENT_LOG_NOT_REGULAR_FILE_REASON =
  "A subagent log in this session's folder is not a regular file (for example a symbolic link), so it was not read and the AI Credits it used are unknown.";
export const SUBAGENT_LOG_READ_FAILED_REASON =
  "A subagent log in this session's folder could not be read, so the AI Credits it used are unknown.";
export const SUBAGENT_FOLDER_UNREADABLE_REASON =
  "This session's folder could not be listed, so subagent logs in it may have been left out.";
export const SUBAGENT_LOGS_TOO_MANY_REASON =
  `This session's folder has more than ${MAX_SUBAGENT_FILES_PER_SESSION} subagent logs, too many to read, so its AI Credits are unknown.`;
export const SUBAGENT_RUN_UNPLACEABLE_REASON = "A subagent log in this session's folder could not be matched to a turn.";
export const SUBAGENT_REF_BEFORE_FIRST_TURN_REASON =
  "A subagent run in this session started before its first prompt, so it could not be matched to a turn.";

// The port to one session folder's subagent logs: the file-system adapter is
// subagent-log-source.ts, tests pass fakes.
export interface SubagentLogSource {
  // Must refuse any name outside SUBAGENT_LOG_NAME (path traversal, §11.2).
  resolve(childLogFile: string): SubagentLogResolution;
  list(): SubagentLogListing;
  // A path `resolve` returned as found. May throw: the run becomes unreadable.
  read(filePath: string): Promise<MainJsonlReadResult>;
}

export interface SubagentAttributionInput {
  // The session folder's id: an orphan belongs here only if its
  // session_start names it as parentSessionId.
  folderId: string;
  refs: readonly ChildSessionRef[];
  // Per 0-based log turn, its user_message's ts (logTurnStartTimes).
  logTurnStarts: readonly (number | null)[];
  source: SubagentLogSource;
}

export interface SubagentAttribution {
  // Runs read and placed, per 0-based log turn: ref order, then orphans
  // matched by time in start order. A run may carry unknown figures (nested,
  // a request without AI Credits); merging makes its turn unknown.
  byLogTurn: Map<number, SubagentRunUsage[]>;
  // Log turns whose ref names a run that couldn't be read: no run stands for
  // it, so the turn's folded figures are unknown with this (first) reason.
  unreadByLogTurn: Map<number, string>;
  // Distinct reasons, in the order found. Empty exactly when every subagent
  // log of the folder was read, placed on a turn and has known AI Credits:
  // only then may the session's AI Credits be known (constraint 6).
  sessionUnknownReasons: string[];
}

const RESOLUTION_REASONS: Record<Exclude<SubagentLogResolution["status"], "found">, string> = {
  "invalid-name": SUBAGENT_LOG_NAME_REJECTED_REASON,
  missing: SUBAGENT_LOG_MISSING_REASON,
  "not-a-regular-file": SUBAGENT_LOG_NOT_REGULAR_FILE_REASON,
};

// The ts of each log turn's user_message (the positional join of
// collectChildSessionRefs), null where it has no usable one.
export function logTurnStartTimes(envelopes: readonly JsonlEnvelope[]): (number | null)[] {
  return envelopes
    .filter((envelope) => envelope.type === "user_message")
    .map((envelope) => (typeof envelope.ts === "number" && Number.isFinite(envelope.ts) ? envelope.ts : null));
}

// The log turn whose window [its user_message.ts, the next one's) holds `at`;
// the last window is open-ended. Null unless exactly one window holds it: no
// turns, before the first, a window bound unknown, or windows that overlap
// (clock skew) all leave the run unplaceable rather than guessed.
export function logTurnAt(logTurnStarts: readonly (number | null)[], at: number): number | null {
  let match: number | null = null;
  for (let index = 0; index < logTurnStarts.length; index++) {
    const from = logTurnStarts[index];
    const to = index + 1 < logTurnStarts.length ? logTurnStarts[index + 1] : Number.POSITIVE_INFINITY;
    if (from === null || to === null || !(from <= at && at < to)) {
      continue;
    }
    if (match !== null) {
      return null;
    }
    match = index;
  }
  return match;
}

type RunReadOutcome =
  | { status: "read"; run: SubagentRunUsage; parentSessionId: string | null }
  | { status: "unreadable"; reason: string };

function parentSessionIdOf(envelopes: readonly JsonlEnvelope[]): string | null {
  const parent = envelopes.find((envelope) => envelope.type === "session_start")?.attrs?.parentSessionId;
  return typeof parent === "string" ? parent : null;
}

async function readRun(
  source: SubagentLogSource,
  fileName: string,
  identity: SubagentRunIdentity,
  attribution: SubagentRunUsage["attribution"],
): Promise<RunReadOutcome> {
  const resolution = source.resolve(fileName);
  if (resolution.status !== "found") {
    return { status: "unreadable", reason: RESOLUTION_REASONS[resolution.status] };
  }

  let content: MainJsonlReadResult;
  try {
    content = await source.read(resolution.path);
  } catch {
    return { status: "unreadable", reason: SUBAGENT_LOG_READ_FAILED_REASON };
  }

  const read = extractSubagentRunUsage(content.envelopes, content.rawLineCount, identity, attribution);
  return read.status === "read" ? { ...read, parentSessionId: parentSessionIdOf(content.envelopes) } : read;
}

// Collects the result; every unknown is also a session reason, so no caller
// can lose one between turn placement and the session total.
class AttributionBuilder {
  private readonly byLogTurn = new Map<number, SubagentRunUsage[]>();
  private readonly unreadByLogTurn = new Map<number, string>();
  private readonly reasons = new Set<string>();

  place(logTurn: number, run: SubagentRunUsage): void {
    this.byLogTurn.set(logTurn, [...(this.byLogTurn.get(logTurn) ?? []), run]);
    if (!run.costAiCredits.known) {
      this.reasons.add(run.costAiCredits.reason);
    }
  }

  unread(logTurn: number, reason: string): void {
    if (!this.unreadByLogTurn.has(logTurn)) {
      this.unreadByLogTurn.set(logTurn, reason);
    }
    this.reasons.add(reason);
  }

  sessionUnknown(reason: string): void {
    this.reasons.add(reason);
  }

  build(): SubagentAttribution {
    return { byLogTurn: this.byLogTurn, unreadByLogTurn: this.unreadByLogTurn, sessionUnknownReasons: [...this.reasons] };
  }
}

// Each ref's run goes to the ref's log turn. Returns the file names the refs
// name, so none of them is read again as an orphan.
async function attributeRefs(
  refs: readonly ChildSessionRef[],
  source: SubagentLogSource,
  builder: AttributionBuilder,
): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const ref of refs) {
    if (ref.childLogFile !== null) {
      if (referenced.has(ref.childLogFile)) {
        continue; // one file, one run: a repeated ref doesn't count it twice
      }
      referenced.add(ref.childLogFile);
    }

    if (ref.logTurnIndex === null) {
      builder.sessionUnknown(SUBAGENT_REF_BEFORE_FIRST_TURN_REASON);
      continue;
    }
    if (ref.childLogFile === null) {
      builder.unread(ref.logTurnIndex, SUBAGENT_LOG_NAME_REJECTED_REASON);
      continue;
    }

    const outcome = await readRun(source, ref.childLogFile, ref, "child-session-ref");
    if (outcome.status === "read") {
      builder.place(ref.logTurnIndex, outcome.run);
    } else {
      builder.unread(ref.logTurnIndex, outcome.reason);
    }
  }
  return referenced;
}

function startedAtMs(run: SubagentRunUsage): number {
  return run.startedAt === undefined ? Number.NaN : Date.parse(run.startedAt);
}

// Files no ref names (D5): placed by time only when the file says it belongs
// to this session and its start falls in exactly one log turn's window.
async function attributeOrphans(
  fileNames: readonly string[],
  { folderId, logTurnStarts, source }: SubagentAttributionInput,
  builder: AttributionBuilder,
): Promise<void> {
  const placed: { logTurn: number; run: SubagentRunUsage }[] = [];
  for (const fileName of fileNames) {
    const outcome = await readRun(source, fileName, { childSessionId: null, label: null }, "timestamp");
    if (outcome.status === "unreadable") {
      builder.sessionUnknown(outcome.reason);
      continue;
    }
    const logTurn = outcome.parentSessionId === folderId ? logTurnAt(logTurnStarts, startedAtMs(outcome.run)) : null;
    if (logTurn === null) {
      builder.sessionUnknown(SUBAGENT_RUN_UNPLACEABLE_REASON);
    } else {
      placed.push({ logTurn, run: outcome.run });
    }
  }

  placed.sort((a, b) => startedAtMs(a.run) - startedAtMs(b.run));
  for (const { logTurn, run } of placed) {
    builder.place(logTurn, run);
  }
}

// One classic session's subagent runs per log turn (step 10.19, plan §4.3,
// design §4.3): refs first, then orphan files by time. Any run that can't be
// read or placed leaves a session reason, never a lower known total.
export async function attributeSubagentRuns(input: SubagentAttributionInput): Promise<SubagentAttribution> {
  const builder = new AttributionBuilder();
  const listing = input.source.list();

  if (listing.tooMany) {
    // Nothing is read (a denial-of-service bound); the refs' turns can't be
    // known either.
    for (const ref of input.refs) {
      if (ref.logTurnIndex !== null) {
        builder.unread(ref.logTurnIndex, SUBAGENT_LOGS_TOO_MANY_REASON);
      }
    }
    builder.sessionUnknown(SUBAGENT_LOGS_TOO_MANY_REASON);
    return builder.build();
  }

  const referenced = await attributeRefs(input.refs, input.source, builder);
  if (listing.unreadable) {
    builder.sessionUnknown(SUBAGENT_FOLDER_UNREADABLE_REASON);
  }
  await attributeOrphans(
    listing.fileNames.filter((fileName) => !referenced.has(fileName)),
    input,
    builder,
  );
  return builder.build();
}
