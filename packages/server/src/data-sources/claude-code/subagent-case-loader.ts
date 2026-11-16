// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { readClaudeCodeSessionFile, type ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { resolveActiveLeafUuid, walkBranch } from "./session-tree.js";
import type { ClaudeCodeRunInput, ClaudeCodeRunTranscript, ClaudeCodeSubagentFolder } from "./subagent-attribution.js";
import { parseSubagentMeta } from "./subagent-meta.js";
import {
  listSubagentTranscripts,
  SUBAGENT_TRANSCRIPT_NAME,
  subagentsDirOf,
  type SubagentRunFiles,
} from "./subagent-transcript-path.js";
import { groupBranchEntriesByUserMessage, type ClaudeCodeTurnGroup } from "./turn-grouper.js";

// Test support: reads one session file and its `subagents/` folder into the
// attribution input. It is also the shape the provider wiring (CS10) builds.
export interface LoadedClaudeCodeSession {
  sessionEntries: ClaudeCodeRawEntry[];
  branch: ClaudeCodeRawEntry[];
  turnGroups: ClaudeCodeTurnGroup[];
  folder: ClaudeCodeSubagentFolder;
  runs: ClaudeCodeRunInput[];
}

/** The session file's active branch and turn groups, as the provider builds them. */
export function branchOf(sessionEntries: ClaudeCodeRawEntry[]): {
  branch: ClaudeCodeRawEntry[];
  turnGroups: ClaudeCodeTurnGroup[];
} {
  const leaf = resolveActiveLeafUuid(sessionEntries);
  const branch = leaf === null ? [] : walkBranch(sessionEntries, leaf);
  return { branch, turnGroups: groupBranchEntriesByUserMessage(branch) };
}

async function transcriptOf(files: SubagentRunFiles): Promise<ClaudeCodeRunTranscript> {
  if (files.transcript === undefined) return { status: "missing" };
  try {
    return { status: "read", entries: (await readClaudeCodeSessionFile(files.transcript.path)).entries };
  } catch {
    return { status: "unreadable" };
  }
}

function metaOf(files: SubagentRunFiles): ClaudeCodeRunInput["meta"] {
  if (files.meta === undefined) return undefined;
  try {
    const parsed = parseSubagentMeta(readFileSync(files.meta.path, "utf8"));
    return parsed.status === "ok" ? parsed.meta : undefined;
  } catch {
    return undefined;
  }
}

export async function loadClaudeCodeSession(sessionFilePath: string): Promise<LoadedClaudeCodeSession> {
  const sessionEntries = (await readClaudeCodeSessionFile(sessionFilePath)).entries;
  const listing = listSubagentTranscripts(subagentsDirOf(sessionFilePath));
  const base = { sessionEntries, ...branchOf(sessionEntries) };

  if (listing.status === "no-folder") return { ...base, folder: { status: "ok" }, runs: [] };
  if (listing.status === "unsafe") return { ...base, folder: { status: "unusable", reason: "not-regular-folder" }, runs: [] };
  if (listing.status === "unreadable") return { ...base, folder: { status: "unusable", reason: "unreadable" }, runs: [] };
  if (listing.status === "too-many") return { ...base, folder: { status: "unusable", reason: "too-many" }, runs: [] };

  const runs = new Map<string, ClaudeCodeRunInput>();
  for (const files of listing.runs) {
    runs.set(files.agentId, { agentId: files.agentId, meta: metaOf(files), transcript: await transcriptOf(files) });
  }
  // A symlinked transcript is refused by the listing: the run keeps its meta
  // and its transcript is "not a regular file", not "missing".
  for (const name of listing.refusedFiles) {
    const agentId = SUBAGENT_TRANSCRIPT_NAME.exec(name)?.[1];
    if (agentId === undefined) continue;
    runs.set(agentId, { ...runs.get(agentId), agentId, transcript: { status: "not-regular-file" } });
  }
  return { ...base, folder: { status: "ok" }, runs: [...runs.values()] };
}

/** The one session file of a fixture case, under `<projects>/-home-dev-project/`. */
export function sessionFileOfCase(projectsDir: string): string {
  const projectDir = path.join(projectsDir, "-home-dev-project");
  const name = readdirSync(projectDir).find((entry) => entry.endsWith(".jsonl"));
  if (name === undefined) throw new Error(`no session file in ${projectDir}`);
  return path.join(projectDir, name);
}
