// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TurnUsage } from "@agent-cost-analyzer/domain";
import type { ClaudeCodeRunTranscriptCache } from "./claude-code-run-cache.js";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { markSessionUsageUnknown } from "./session-unknown-usage.js";
import {
  attributeClaudeCodeRuns,
  SUBAGENT_TRANSCRIPT_MISSING_REASON,
  type ClaudeCodeRunInput,
  type ClaudeCodeSubagentAttribution,
} from "./subagent-attribution.js";
import { readSubagentFolder } from "./subagent-folder-reader.js";
import { runIdsHeldByOtherSessions } from "./subagent-other-sessions.js";
import { mergeClaudeCodeSubagentUsage } from "./subagent-usage-merge.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";

export interface SubagentFoldInput {
  sessionFilePath: string;
  /** The provider's own list of session files; the project's other sessions are among them. */
  siblingSessionFilePaths: readonly string[];
  sessionEntries: readonly ClaudeCodeRawEntry[];
  branch: readonly ClaudeCodeRawEntry[];
  turnGroups: readonly ClaudeCodeTurnGroup[];
  /** The main agent's own usage per turn, in turn order. */
  turnUsages: readonly TurnUsage[];
}

export interface SubagentFoldResult {
  /** Own usage plus the runs each turn started; unknown where a run or the session is. */
  usages: TurnUsage[];
  /** Per turn index, for example a run counted in another session. */
  notesByTurn: ReadonlyMap<number, readonly string[]>;
  /** Runs whose call is off the active branch: not counted, kept for the oracle. */
  offBranchRunIds: readonly string[];
  sessionUnknownReasons: readonly string[];
  /** What the usage fold placed, for the tool audit (CS14) to read the same runs. */
  attribution: ClaudeCodeSubagentAttribution;
  /** The folder's runs with their allow-listed metas. */
  runs: readonly ClaudeCodeRunInput[];
}

const hasMissingRun = (attribution: ClaudeCodeSubagentAttribution): boolean =>
  [...attribution.byTurn.values()].some(({ runs }) =>
    runs.some((run) => !run.output.known && run.output.reason === SUBAGENT_TRANSCRIPT_MISSING_REASON),
  );

/**
 * The one place a Claude Code session's subagent usage is read, attributed and
 * merged: the Sessions list and the session detail both call it, so their
 * totals cannot differ (plan section 5.6, "list equals detail").
 */
export async function foldClaudeCodeSubagentUsage(
  input: SubagentFoldInput,
  cache: ClaudeCodeRunTranscriptCache,
): Promise<SubagentFoldResult> {
  const { folder, runs } = await readSubagentFolder(input.sessionFilePath, (filePath) => cache.load(filePath));
  const attributionInput = {
    runs,
    folder,
    branch: input.branch,
    turnGroups: input.turnGroups,
    sessionEntries: input.sessionEntries,
  };

  let attribution = attributeClaudeCodeRuns(attributionInput);
  // D7 needs other sessions' folders. It is asked only for a call that found no
  // run of its own, which is rare, so a session with all its runs pays nothing.
  if (hasMissingRun(attribution)) {
    const countedInOtherSessions = runIdsHeldByOtherSessions(input.sessionFilePath, input.siblingSessionFilePaths);
    if (countedInOtherSessions.size > 0) {
      attribution = attributeClaudeCodeRuns({ ...attributionInput, countedInOtherSessions });
    }
  }

  const merged = mergeClaudeCodeSubagentUsage(input.turnUsages, attribution) as TurnUsage[];
  return {
    usages: markSessionUsageUnknown(merged, attribution.sessionUnknownReasons),
    notesByTurn: new Map([...attribution.byTurn].filter(([, { notes }]) => notes.length > 0).map(([turn, { notes }]) => [turn, notes])),
    offBranchRunIds: attribution.offBranchRunIds,
    sessionUnknownReasons: attribution.sessionUnknownReasons,
    attribution,
    runs,
  };
}
