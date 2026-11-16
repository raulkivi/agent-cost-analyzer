// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { readSubagentMetaFile } from "./subagent-folder-reader.js";
import { listSubagentTranscripts, subagentsDirOf } from "./subagent-transcript-path.js";

/**
 * Plan D7: the call ids and agent ids of the runs that other sessions of the
 * same project hold in their `subagents/` folders. Only names and metas are
 * read, never transcripts; the caller asks only for a session with a call that
 * has no run of its own. `siblingSessionFilePaths` is the provider's own
 * enumeration, so a log value never picks a folder to read.
 */
export function runIdsHeldByOtherSessions(sessionFilePath: string, siblingSessionFilePaths: readonly string[]): Set<string> {
  const ids = new Set<string>();
  const projectDir = path.dirname(sessionFilePath);
  for (const sibling of siblingSessionFilePaths) {
    if (sibling === sessionFilePath || path.dirname(sibling) !== projectDir) continue;
    const listing = listSubagentTranscripts(subagentsDirOf(sibling));
    if (listing.status !== "ok") continue;
    for (const files of listing.runs) {
      ids.add(files.agentId);
      const toolUseId = readSubagentMetaFile(files.meta)?.toolUseId;
      if (toolUseId !== undefined) ids.add(toolUseId);
    }
  }
  return ids;
}
