// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

// Claude Code subagent runs sit in <session>/subagents/ next to the session
// file (plan §5.3). Nothing in a log names a file: the folder comes from the
// provider's own session path and runs are found by listing it, so a log value
// can never steer a read outside it. Names are a bare allow-list (no dot or
// separator beyond the suffix) and every entry is lstat-ed, so a symlink is
// refused rather than followed.
export const SUBAGENT_TRANSCRIPT_NAME = /^agent-([A-Za-z0-9]{1,64})\.jsonl$/;
export const SUBAGENT_META_NAME = /^agent-([A-Za-z0-9]{1,64})\.meta\.json$/;

// Seen at most 96 per session. Above the cap no run is read and the session's
// figures are unknown, never a partial sum of the files read (constraint 6).
export const MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION = 500;

export interface SubagentStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
}

/** The two fs calls the resolver needs, injected so tests need no disk. */
export interface SubagentFs {
  lstat(path: string): SubagentStat;
  readdir(path: string): string[];
}

const nodeFs: SubagentFs = {
  lstat: (p) => lstatSync(p),
  readdir: (p) => readdirSync(p),
};

export interface SubagentFileRef {
  path: string;
  size: number;
}

export interface SubagentRunFiles {
  agentId: string;
  /** Absent when the run has a meta only, or the transcript was refused. */
  transcript?: SubagentFileRef;
  /** Absent when the run has a transcript only, or the meta was refused. */
  meta?: SubagentFileRef;
}

export type SubagentListing =
  /** The session has no `subagents/` folder: no runs, and the figures stay known. */
  | { status: "no-folder" }
  /** A folder is a symlink or not a directory: nothing is read. */
  | { status: "unsafe"; reason: "not a regular folder" }
  /** The folder exists but couldn't be listed: unknown, not empty. */
  | { status: "unreadable" }
  | { status: "too-many"; count: number }
  | {
      status: "ok";
      /** Sorted by agent id. */
      runs: SubagentRunFiles[];
      /** Allow-listed names whose entry isn't a regular file (symlink, directory). */
      refusedFiles: string[];
    };

/** The session's `subagents/` folder, from the provider's own session file path. */
export function subagentsDirOf(sessionFilePath: string): string {
  const sessionDir = path.join(path.dirname(sessionFilePath), path.basename(sessionFilePath, ".jsonl"));
  return path.join(sessionDir, "subagents");
}

type FolderState = "directory" | "missing" | "unsafe";

function folderState(fs: SubagentFs, folder: string): FolderState {
  try {
    const stat = fs.lstat(folder);
    return stat.isDirectory() && !stat.isSymbolicLink() ? "directory" : "unsafe";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unsafe";
  }
}

function runMatching(runs: Map<string, SubagentRunFiles>, agentId: string): SubagentRunFiles {
  let run = runs.get(agentId);
  if (run === undefined) {
    run = { agentId };
    runs.set(agentId, run);
  }
  return run;
}

/**
 * Lists a session's subagent runs from its `subagents/` folder. Each of the
 * session folder and `subagents/` must be a real directory.
 */
export function listSubagentTranscripts(subagentsDir: string, fs: SubagentFs = nodeFs): SubagentListing {
  const sessionState = folderState(fs, path.dirname(subagentsDir));
  if (sessionState === "unsafe") return { status: "unsafe", reason: "not a regular folder" };
  if (sessionState === "missing") return { status: "no-folder" };
  const state = folderState(fs, subagentsDir);
  if (state === "unsafe") return { status: "unsafe", reason: "not a regular folder" };
  if (state === "missing") return { status: "no-folder" };

  let names: string[];
  try {
    names = fs.readdir(subagentsDir);
  } catch {
    return { status: "unreadable" };
  }

  // Other names (.forked-skill*, stray files) are ignored, never read.
  type Candidate = { name: string; agentId: string; kind: "transcript" | "meta" };
  const candidates = names.flatMap((name): Candidate[] => {
    const transcript = SUBAGENT_TRANSCRIPT_NAME.exec(name);
    if (transcript?.[1] !== undefined) return [{ name, agentId: transcript[1], kind: "transcript" as const }];
    const meta = SUBAGENT_META_NAME.exec(name);
    return meta?.[1] === undefined ? [] : [{ name, agentId: meta[1], kind: "meta" as const }];
  });

  const ids = new Set(candidates.map((candidate) => candidate.agentId));
  if (ids.size > MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION) return { status: "too-many", count: ids.size };

  const runs = new Map<string, SubagentRunFiles>();
  const refusedFiles: string[] = [];
  for (const { name, agentId, kind } of candidates.sort((a, b) => a.name.localeCompare(b.name))) {
    const filePath = path.join(subagentsDir, name);
    let ref: SubagentFileRef | undefined;
    try {
      const stat = fs.lstat(filePath);
      if (stat.isFile() && !stat.isSymbolicLink()) ref = { path: filePath, size: stat.size };
    } catch {
      // Vanished or unreadable between the listing and the lstat: treat as refused.
    }
    if (ref === undefined) refusedFiles.push(name);
    else runMatching(runs, agentId)[kind] = ref;
  }

  return {
    status: "ok",
    runs: [...runs.values()].sort((a, b) => a.agentId.localeCompare(b.agentId)),
    refusedFiles,
  };
}
