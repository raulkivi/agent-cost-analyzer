// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  SUBAGENT_FOLDER_NOT_REGULAR_REASON,
  SUBAGENT_FOLDER_UNREADABLE_REASON,
  SUBAGENT_NESTING_TOO_DEEP_REASON,
  SUBAGENT_TOO_MANY_REASON,
  SUBAGENT_TRANSCRIPT_MISSING_REASON,
  SUBAGENT_TRANSCRIPT_NOT_REGULAR_REASON,
  SUBAGENT_TRANSCRIPT_UNREADABLE_REASON,
} from "./subagent-attribution.js";
import { MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION } from "./subagent-transcript-path.js";

// CS14 (plan section 6, tool-audit plan section 6): why a Claude Code run's
// tool calls are unknown. Plain sentences, none embeds log text beyond the
// validated label: each reaches the UI and MCP tools as
// `AuditedRun.unreadReason`. The usage side words the same causes in terms of
// tokens, so each is mapped to a sentence about tool calls.
export const missingTranscriptReason = (label: string): string =>
  `The subagent transcript \`${label}\` this turn started is missing, so its tool calls are unknown.`;
export const NOT_REGULAR_TRANSCRIPT_AUDIT_REASON =
  "A subagent transcript in this session's folder is not a regular file (for example a symbolic link), so it was not read and its tool calls are unknown.";
export const UNREADABLE_TRANSCRIPT_AUDIT_REASON =
  "A subagent transcript could not be read, so the tool calls of the run it holds are unknown.";
export const NOT_REGULAR_FOLDER_AUDIT_REASON =
  "This session's subagents folder is not a regular folder (for example a symbolic link), so no subagent transcript was read and the tool calls of its runs are unknown.";
export const UNREADABLE_FOLDER_AUDIT_REASON =
  "This session's subagents folder could not be listed, so the tool calls of its runs are unknown.";
export const TOO_MANY_TRANSCRIPTS_AUDIT_REASON = `There are too many subagent transcripts to read (more than ${MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION} in this session's folder), so the tool calls of this run are unknown.`;
export const BEYOND_READ_DEPTH_AUDIT_REASON =
  "This run is nested deeper than the analyzer follows: nested subagents beyond the read depth are not read, so its tool calls are unknown.";

/**
 * The audit sentence for a usage-side reason that means "the transcript was
 * not read", or undefined for any other reason (a round missing a usage
 * field leaves the transcript readable, so its calls are known).
 */
export function auditReasonOfUsageReason(usageReason: string, label: string): string | undefined {
  switch (usageReason) {
    case SUBAGENT_TRANSCRIPT_MISSING_REASON:
      return missingTranscriptReason(label);
    case SUBAGENT_TRANSCRIPT_NOT_REGULAR_REASON:
      return NOT_REGULAR_TRANSCRIPT_AUDIT_REASON;
    case SUBAGENT_TRANSCRIPT_UNREADABLE_REASON:
      return UNREADABLE_TRANSCRIPT_AUDIT_REASON;
    case SUBAGENT_FOLDER_NOT_REGULAR_REASON:
      return NOT_REGULAR_FOLDER_AUDIT_REASON;
    case SUBAGENT_FOLDER_UNREADABLE_REASON:
      return UNREADABLE_FOLDER_AUDIT_REASON;
    case SUBAGENT_TOO_MANY_REASON:
      return TOO_MANY_TRANSCRIPTS_AUDIT_REASON;
    case SUBAGENT_NESTING_TOO_DEEP_REASON:
      return BEYOND_READ_DEPTH_AUDIT_REASON;
    default:
      return undefined;
  }
}
