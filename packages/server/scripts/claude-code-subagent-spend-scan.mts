// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Folder scan of the Claude Code subagent real-data check (plan
// claude-code-subagents.md §10, CS16): reads ~/.claude/projects as the oracle
// needs it, and shares no code with the server's readers. Read-only: it opens
// files for reading, takes `lstat`s, and only `hardLinkView` creates anything,
// and only under the folder it is given.
import { linkSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MAX_RUN_FILES, type OracleRunInput, type OracleSessionInput, type OracleTranscript } from "./claude-code-subagent-spend-lib.mjs";
import { parseJsonl } from "./savings-oracle.mjs";

// A file written this recently belongs to a live session.
export const LIVE_MS = 15 * 60_000;
const MAX_META_BYTES = 64 * 1024;
const TRANSCRIPT = /^agent-([A-Za-z0-9]{1,64})\.jsonl$/;
const META = /^agent-([A-Za-z0-9]{1,64})\.meta\.json$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface ClaudeSessionFiles {
  project: string;
  sessionId: string;
  file: string;
  // The session file first, then every file of its subagents folder.
  files: string[];
  // Transcripts and metas the oracle reads (allowed names only).
  subagentFileCount: number;
  newestMtimeMs: number;
}

const safeReaddir = (dir: string): string[] | undefined => {
  try {
    return readdirSync(dir);
  } catch {
    return undefined;
  }
};

const safeLstat = (file: string) => {
  try {
    return lstatSync(file);
  } catch {
    return undefined;
  }
};

const isRealDir = (dir: string): boolean => safeLstat(dir)?.isDirectory() === true;

export const subagentsDirOf = (sessionFile: string): string => path.join(path.dirname(sessionFile), path.basename(sessionFile, ".jsonl"), "subagents");

// Sessions as the product enumerates them (two levels, `.jsonl` files), split
// by whether the session file or any file of its subagents folder was written
// within the live window.
export function listClaudeSessions(projectsDir: string, now: number): { stable: ClaudeSessionFiles[]; live: ClaudeSessionFiles[] } {
  const stable: ClaudeSessionFiles[] = [];
  const live: ClaudeSessionFiles[] = [];
  for (const project of (safeReaddir(projectsDir) ?? []).sort()) {
    const projectDir = path.join(projectsDir, project);
    if (!isRealDir(projectDir)) continue;
    for (const name of (safeReaddir(projectDir) ?? []).sort()) {
      const file = path.join(projectDir, name);
      if (!name.toLowerCase().endsWith(".jsonl") || safeLstat(file)?.isFile() !== true) continue;
      const dir = subagentsDirOf(file);
      const names = isRealDir(dir) ? (safeReaddir(dir) ?? []).sort() : [];
      const files = [file, ...names.map((n) => path.join(dir, n))];
      const newest = Math.max(...files.map((f) => safeLstat(f)?.mtimeMs ?? 0));
      const row: ClaudeSessionFiles = {
        project,
        sessionId: path.basename(name, path.extname(name)),
        file,
        files,
        subagentFileCount: names.filter((n) => TRANSCRIPT.test(n) || META.test(n)).length,
        newestMtimeMs: newest,
      };
      (now - newest < LIVE_MS ? live : stable).push(row);
    }
  }
  return { stable, live };
}

// A hard-linked mirror of the given sessions: the products read it as the real
// folder (their path rules refuse symlinks), a live session never enters it, and
// nothing is copied. A hard link is another name for the same file, so removing
// the view leaves every original as it was.
export function hardLinkView(sessions: readonly ClaudeSessionFiles[], viewDir: string): void {
  for (const session of sessions) {
    for (const source of session.files) {
      const target = path.join(viewDir, path.relative(path.dirname(path.dirname(session.file)), source));
      try {
        mkdirSync(path.dirname(target), { recursive: true });
        linkSync(source, target);
      } catch (error) {
        throw new Error(
          `Could not hard-link a log file into the view (${(error as NodeJS.ErrnoException).code ?? "error"}). The view folder must be on the same file system as the projects folder: set REAL_DATA_VIEW_PARENT to a folder there.`,
          { cause: error },
        );
      }
    }
  }
}

// --------------------------------------------------------------- the oracle input

const textOf = (file: string): string | undefined => {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
};

function metaOf(file: string | undefined): OracleRunInput["meta"] {
  if (file === undefined) return undefined;
  const stat = safeLstat(file);
  if (!stat?.isFile() || stat.size > MAX_META_BYTES) return undefined;
  const text = textOf(file);
  if (text === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const id = (value: unknown) => (typeof value === "string" && ID.test(value) ? value : undefined);
  const toolUseId = id(record.toolUseId);
  const parentAgentId = id(record.parentAgentId);
  return { ...(toolUseId === undefined ? {} : { toolUseId }), ...(parentAgentId === undefined ? {} : { parentAgentId }) };
}

interface Listed {
  folder: OracleSessionInput["folder"];
  // agent id -> the file names present
  runs: Map<string, { transcript?: string; meta?: string }>;
}

function listFolder(sessionFile: string): Listed {
  const sessionDir = path.join(path.dirname(sessionFile), path.basename(sessionFile, ".jsonl"));
  const dir = path.join(sessionDir, "subagents");
  for (const folder of [sessionDir, dir]) {
    const stat = safeLstat(folder);
    if (stat === undefined) return { folder: { status: "ok" }, runs: new Map() };
    if (!stat.isDirectory()) return { folder: { status: "not-regular-folder" }, runs: new Map() };
  }
  const names = safeReaddir(dir);
  if (names === undefined) return { folder: { status: "unreadable" }, runs: new Map() };
  const runs = new Map<string, { transcript?: string; meta?: string }>();
  for (const name of names.sort()) {
    const transcript = TRANSCRIPT.exec(name)?.[1];
    const meta = META.exec(name)?.[1];
    const id = transcript ?? meta;
    if (id === undefined) continue;
    const entry = runs.get(id) ?? {};
    entry[transcript === undefined ? "meta" : "transcript"] = name;
    runs.set(id, entry);
  }
  if (runs.size > MAX_RUN_FILES) return { folder: { status: "too-many" }, runs: new Map() };
  return { folder: { status: "ok" }, runs };
}

function transcriptOf(dir: string, name: string | undefined): OracleTranscript {
  if (name === undefined) return { status: "missing" };
  const file = path.join(dir, name);
  if (safeLstat(file)?.isFile() !== true) return { status: "not-regular-file" };
  const text = textOf(file);
  // A line cut short by a live writer fails to parse and is not data.
  return text === undefined ? { status: "unreadable" } : { status: "read", lines: parseJsonl(text) };
}

// The ids (agent ids and the calls' ids) the project's other sessions' folders hold: D7.
function heldBySiblings(sessionFile: string, siblingSessionFiles: readonly string[]): Set<string> {
  const held = new Set<string>();
  for (const sibling of siblingSessionFiles) {
    if (sibling === sessionFile || path.dirname(sibling) !== path.dirname(sessionFile)) continue;
    const listed = listFolder(sibling);
    for (const [agentId, files] of listed.runs) {
      held.add(agentId);
      const toolUseId = metaOf(files.meta === undefined ? undefined : path.join(subagentsDirOf(sibling), files.meta))?.toolUseId;
      if (toolUseId !== undefined) held.add(toolUseId);
    }
  }
  return held;
}

export function readOracleInput(sessionFile: string, siblingSessionFiles: readonly string[] = []): OracleSessionInput {
  const dir = subagentsDirOf(sessionFile);
  const listed = listFolder(sessionFile);
  const runs: OracleRunInput[] = [...listed.runs].map(([agentId, files]) => {
    const meta = metaOf(files.meta === undefined ? undefined : path.join(dir, files.meta));
    return { agentId, ...(meta === undefined ? {} : { meta }), transcript: transcriptOf(dir, files.transcript) };
  });
  return {
    lines: parseJsonl(textOf(sessionFile) ?? ""),
    folder: listed.folder,
    runs,
    heldElsewhere: heldBySiblings(sessionFile, siblingSessionFiles),
  };
}
