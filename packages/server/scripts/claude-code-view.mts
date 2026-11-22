// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The view of Claude Code's projects folder the real-data checks hand to the
// products and oracles. Every file in it is a regular-file copy (with the
// original's write time), a frozen snapshot: a stable session can still be
// resumed and grow while a check runs for many minutes, and the product and the
// oracle must read the same bytes. A session written in the last LIVE_MS is a
// live session, left out and counted. The session's subagents/ folder is a real
// folder too: the product refuses a symlinked folder or transcript on purpose
// (plan https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/claude-code-subagents.md §5.3), and without the folder every Agent call
// reads as a missing run and its turn as unknown (1.0 criterion C15). The
// owner's files are only read.
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, statSync, utimesSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// Where the checks put their views: the whole of the owner's logs is copied, so
// not into a RAM-backed tmpdir (REAL_DATA_VIEW_PARENT, default ~/.cache). A check
// removes its folders when it ends.
export function viewParentDir(env: Record<string, string | undefined> = process.env): string {
  const set = env.REAL_DATA_VIEW_PARENT;
  return set !== undefined && set !== "" ? set : path.join(homedir(), ".cache");
}

export function createViewDir(prefix: string, parent: string = viewParentDir()): string {
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, prefix));
}

export interface ClaudeCodeView {
  dir: string;
  // The snapshot copies the products and oracles read.
  files: string[];
  // The owner's files behind them (sessions and subagent files), for the read-only check.
  targets: string[];
  // Per session: its copy, its original and its run files' originals.
  sessions: { link: string; source: string; runSources: string[] }[];
  // Sessions left out because the session file or one of its run files is live.
  live: number;
}

const RUN_FILE = /^agent-[A-Za-z0-9]{1,64}\.(jsonl|meta\.json)$/;

const isDir = (p: string): boolean => {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};

const runFilesOf = (sessionFile: string): string[] => {
  const dir = path.join(sessionFile.replace(/\.jsonl$/i, ""), "subagents");
  return isDir(dir) ? readdirSync(dir).filter((name) => RUN_FILE.test(name) && statSync(path.join(dir, name)).isFile()).map((name) => path.join(dir, name)) : [];
};

// The original's write time stays, so a session keeps its place by age.
export function copyKeepingTime(from: string, to: string): void {
  copyFileSync(from, to);
  const { atime, mtime } = statSync(from);
  utimesSync(to, atime, mtime);
}

export function buildClaudeCodeView(source: string, dir: string, now: number, liveMs: number): ClaudeCodeView {
  const view: ClaudeCodeView = { dir, files: [], targets: [], sessions: [], live: 0 };
  mkdirSync(dir, { recursive: true });
  if (!isDir(source)) return view;
  for (const folder of readdirSync(source).sort()) {
    const folderPath = path.join(source, folder);
    if (!isDir(folderPath)) continue;
    for (const name of readdirSync(folderPath).sort()) {
      const target = path.join(folderPath, name);
      if (!name.toLowerCase().endsWith(".jsonl") || !statSync(target).isFile()) continue;
      const runFiles = runFilesOf(target);
      if ([target, ...runFiles].some((file) => now - statSync(file).mtimeMs < liveMs)) {
        view.live += 1;
        continue;
      }
      mkdirSync(path.join(dir, folder), { recursive: true });
      const link = path.join(dir, folder, name);
      copyKeepingTime(target, link);
      if (runFiles.length > 0) {
        const runDir = path.join(link.replace(/\.jsonl$/i, ""), "subagents");
        mkdirSync(runDir, { recursive: true });
        for (const file of runFiles) copyKeepingTime(file, path.join(runDir, path.basename(file)));
      }
      view.files.push(link);
      view.targets.push(target, ...runFiles);
      view.sessions.push({ link, source: target, runSources: runFiles });
    }
  }
  return view;
}
