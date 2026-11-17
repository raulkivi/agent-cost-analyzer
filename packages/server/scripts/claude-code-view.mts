// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The view of Claude Code's projects folder the real-data checks hand to the
// products. A session file is a symlink to the owner's file (a file written
// in the last LIVE_MS is a live session, left out and counted). The session's
// subagents/ folder is a real folder of regular-file copies: the product
// refuses a symlinked folder or transcript on purpose (plan
// claude-code-subagents.md §5.3), and without the folder every Agent call reads
// as a missing run and its turn as unknown (1.0 criterion C15). The copies are
// a snapshot, so the product and the oracle read the same bytes. The owner's
// files are only read.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";

export interface ClaudeCodeView {
  dir: string;
  // The symlinks the products and oracles read.
  files: string[];
  // The owner's files behind them (sessions and subagent files), for the read-only fingerprint.
  targets: string[];
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

export function buildClaudeCodeView(source: string, dir: string, now: number, liveMs: number): ClaudeCodeView {
  const view: ClaudeCodeView = { dir, files: [], targets: [], live: 0 };
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
      symlinkSync(target, link);
      if (runFiles.length > 0) {
        const runDir = path.join(link.replace(/\.jsonl$/i, ""), "subagents");
        mkdirSync(runDir, { recursive: true });
        for (const file of runFiles) copyFileSync(file, path.join(runDir, path.basename(file)));
      }
      view.files.push(link);
      view.targets.push(target, ...runFiles);
    }
  }
  return view;
}
