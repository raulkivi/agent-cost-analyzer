// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readClaudeCodeSessionFile } from "./claude-code-jsonl-reader.js";
import type { LoadRunEntries } from "./claude-code-subagent-audit.js";
import { listSubagentTranscripts, subagentsDirOf } from "./subagent-transcript-path.js";

/**
 * Reads a run's full transcript for the audit (detail path only). The file is
 * found through the same listing as the usage read, never joined from a log
 * value: bare names, `lstat`, symlinks refused. Each file is read when asked
 * for and not kept, so a session's transcripts are never all in memory.
 */
export function folderRunEntriesLoader(sessionFilePath: string): LoadRunEntries {
  const listing = listSubagentTranscripts(subagentsDirOf(sessionFilePath));
  const pathOf = new Map(
    listing.status === "ok"
      ? listing.runs.flatMap((run) => (run.transcript === undefined ? [] : [[run.agentId, run.transcript.path] as const]))
      : [],
  );
  return async (agentId) => {
    const filePath = pathOf.get(agentId);
    return filePath === undefined ? null : (await readClaudeCodeSessionFile(filePath)).entries;
  };
}
