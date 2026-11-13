// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

// A classic subagent run's log sits next to the parent's main.jsonl (step
// 10.19): runSubagent-<agent>-<toolCallId>.jsonl or
// searchSubagent-<toolCallId>.jsonl. The name allow-list has no separator and
// no dot besides the suffix, so a name taken from a log (child_session_ref's
// childLogFile) can never leave the session folder (§11.2).
export const SUBAGENT_LOG_NAME = /^(runSubagent-[A-Za-z0-9_-]+|searchSubagent-[A-Za-z0-9_-]+)\.jsonl$/;

// design §1.1 saw at most 3 per session. Above the cap the session's total is
// unknown, never a partial sum of the files read (constraint 6).
export const MAX_SUBAGENT_FILES_PER_SESSION = 200;

export type SubagentLogResolution =
  | { status: "found"; path: string }
  | { status: "invalid-name" }
  | { status: "missing" }
  // A symlink, a directory or anything else that isn't a plain file.
  | { status: "not-a-regular-file" };

// Resolves a log-supplied file name inside the session folder only. lstat,
// not stat: a symlink is refused rather than followed.
export function resolveSubagentLogPath(sessionDir: string, childLogFile: string): SubagentLogResolution {
  if (!SUBAGENT_LOG_NAME.test(childLogFile)) {
    return { status: "invalid-name" };
  }

  const candidate = path.join(sessionDir, childLogFile);
  try {
    return lstatSync(candidate).isFile() ? { status: "found", path: candidate } : { status: "not-a-regular-file" };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { status: "missing" } : { status: "not-a-regular-file" };
  }
}

export interface SubagentLogListing {
  // Matching names, sorted, at most MAX_SUBAGENT_FILES_PER_SESSION. Every
  // entry with a matching name is listed whatever it is, so resolving it can
  // report a symlink or directory instead of the scan hiding it.
  fileNames: string[];
  tooMany: boolean;
  // The folder couldn't be read, so files may exist that this listing can't
  // see. Not the same as an empty listing: the caller makes the session total
  // unknown rather than silently leaving orphan files out (constraint 6).
  unreadable: boolean;
}

export function listSubagentLogFiles(sessionDir: string): SubagentLogListing {
  let names: string[];
  try {
    names = readdirSync(sessionDir);
  } catch {
    return { fileNames: [], tooMany: false, unreadable: true };
  }

  const matching = names.filter((name) => SUBAGENT_LOG_NAME.test(name)).sort();
  return {
    fileNames: matching.slice(0, MAX_SUBAGENT_FILES_PER_SESSION),
    tooMany: matching.length > MAX_SUBAGENT_FILES_PER_SESSION,
    unreadable: false,
  };
}
