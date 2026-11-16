// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { stat } from "node:fs/promises";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import type { ClaudeCodeRunTranscript } from "./subagent-attribution.js";
import { readSubagentTranscript } from "./subagent-transcript-reader.js";

// Run summaries for the Sessions list (plan D16): the slim lines of each
// subagent transcript, kept while the file's size and mtime are unchanged. The
// list reads every session, and a project can hold gigabytes of transcripts;
// without this each refresh would parse them all again. The lines hold numbers
// and ids only (subagent-transcript-reader.ts), and both the files and the
// lines kept are bounded. Callers treat the entries as read-only.

export interface RunFileStamp {
  size: number;
  mtimeMs: number;
}

export interface ClaudeCodeRunCacheOptions {
  /** Null when the file doesn't exist; rejects on any other I/O error. */
  stat?: (filePath: string) => Promise<RunFileStamp | null>;
  read?: (filePath: string) => Promise<ClaudeCodeRawEntry[]>;
  maxFiles?: number;
  /** Total slim lines kept across files (about 300 bytes each). */
  maxEntries?: number;
}

export const DEFAULT_RUN_CACHE_FILES = 1024;
export const DEFAULT_RUN_CACHE_ENTRIES = 200_000;

async function statRunFile(filePath: string): Promise<RunFileStamp | null> {
  try {
    const stats = await stat(filePath);
    return { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

interface Entry {
  stamp: RunFileStamp;
  // Shared by concurrent loads, so one parse serves them all.
  load: Promise<ClaudeCodeRunTranscript>;
  entryCount: number;
}

export class ClaudeCodeRunTranscriptCache {
  // Map order is recency: a hit moves to the end, the first key is evicted.
  private readonly entries = new Map<string, Entry>();
  private readonly statFile: NonNullable<ClaudeCodeRunCacheOptions["stat"]>;
  private readonly readFile: NonNullable<ClaudeCodeRunCacheOptions["read"]>;
  private readonly maxFiles: number;
  private readonly maxEntries: number;
  private keptEntries = 0;

  constructor(options: ClaudeCodeRunCacheOptions = {}) {
    this.statFile = options.stat ?? statRunFile;
    this.readFile = options.read ?? readSubagentTranscript;
    this.maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_RUN_CACHE_FILES);
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_RUN_CACHE_ENTRIES);
  }

  async load(filePath: string): Promise<ClaudeCodeRunTranscript> {
    let stamp: RunFileStamp | null;
    try {
      stamp = await this.statFile(filePath);
    } catch {
      this.drop(filePath);
      return { status: "unreadable" };
    }
    if (stamp === null) {
      this.drop(filePath);
      return { status: "missing" };
    }

    const cached = this.entries.get(filePath);
    if (cached !== undefined && cached.stamp.size === stamp.size && cached.stamp.mtimeMs === stamp.mtimeMs) {
      this.entries.delete(filePath);
      this.entries.set(filePath, cached);
      return cached.load;
    }

    // The stamp is taken before the read, so a file appended to meanwhile reads
    // as changed next time: a stale entry is read again, never kept.
    this.drop(filePath);
    const load = this.parse(filePath);
    const entry: Entry = { stamp, load, entryCount: 0 };
    this.entries.set(filePath, entry);
    const result = await load;
    if (this.entries.get(filePath) !== entry) return result;

    if (result.status !== "read" || result.entries.length > this.maxEntries) {
      this.entries.delete(filePath); // a failure is retried; one huge transcript is not worth holding
    } else {
      entry.entryCount = result.entries.length;
      this.keptEntries += entry.entryCount;
      this.evictOverflow();
    }
    return result;
  }

  private async parse(filePath: string): Promise<ClaudeCodeRunTranscript> {
    try {
      return { status: "read", entries: await this.readFile(filePath) };
    } catch {
      return { status: "unreadable" };
    }
  }

  private drop(filePath: string): void {
    const entry = this.entries.get(filePath);
    if (entry === undefined) return;
    this.keptEntries -= entry.entryCount;
    this.entries.delete(filePath);
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxFiles || this.keptEntries > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.drop(oldest);
    }
  }
}
