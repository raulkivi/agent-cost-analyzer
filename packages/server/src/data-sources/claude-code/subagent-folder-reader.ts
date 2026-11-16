// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import type { ClaudeCodeRunInput, ClaudeCodeRunTranscript, ClaudeCodeSubagentFolder } from "./subagent-attribution.js";
import { MAX_SUBAGENT_META_BYTES, parseSubagentMeta, type SubagentMeta } from "./subagent-meta.js";
import {
  listSubagentTranscripts,
  SUBAGENT_TRANSCRIPT_NAME,
  subagentsDirOf,
  type SubagentFileRef,
} from "./subagent-transcript-path.js";

export type LoadRunTranscript = (filePath: string) => Promise<ClaudeCodeRunTranscript>;

export interface SubagentFolderRead {
  folder: ClaudeCodeSubagentFolder;
  runs: ClaudeCodeRunInput[];
}

/** The allow-listed keys of a run's meta file, or undefined when it is absent, too large or malformed. */
export function readSubagentMetaFile(ref: SubagentFileRef | undefined): SubagentMeta | undefined {
  if (ref === undefined || ref.size > MAX_SUBAGENT_META_BYTES) return undefined; // never read a file the cap refuses
  try {
    const parsed = parseSubagentMeta(readFileSync(ref.path, "utf8"));
    return parsed.status === "ok" ? parsed.meta : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads a session's `subagents/` folder into the attribution input. The folder
 * comes from the session file's own path (plan section 5.3); transcripts are
 * loaded one at a time through `loadTranscript`, which is the run-summary cache.
 */
export async function readSubagentFolder(sessionFilePath: string, loadTranscript: LoadRunTranscript): Promise<SubagentFolderRead> {
  const listing = listSubagentTranscripts(subagentsDirOf(sessionFilePath));
  switch (listing.status) {
    case "no-folder":
      return { folder: { status: "ok" }, runs: [] };
    case "unsafe":
      return { folder: { status: "unusable", reason: "not-regular-folder" }, runs: [] };
    case "unreadable":
      return { folder: { status: "unusable", reason: "unreadable" }, runs: [] };
    case "too-many":
      return { folder: { status: "unusable", reason: "too-many" }, runs: [] };
    case "ok":
      break;
  }

  const runs = new Map<string, ClaudeCodeRunInput>();
  for (const files of listing.runs) {
    runs.set(files.agentId, {
      agentId: files.agentId,
      meta: readSubagentMetaFile(files.meta),
      transcript: files.transcript === undefined ? { status: "missing" } : await loadTranscript(files.transcript.path),
    });
  }
  // A symlinked transcript is refused by the listing: the run keeps its meta
  // and its transcript is "not a regular file", not "missing".
  for (const name of listing.refusedFiles) {
    const agentId = SUBAGENT_TRANSCRIPT_NAME.exec(name)?.[1];
    if (agentId === undefined) continue;
    runs.set(agentId, { ...runs.get(agentId), agentId, transcript: { status: "not-regular-file" } });
  }
  return { folder: { status: "ok" }, runs: [...runs.values()] };
}
