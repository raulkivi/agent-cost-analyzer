import { stat } from "node:fs/promises";
import type { CopilotEventLog } from "./copilot-event.js";

// Parsed Copilot CLI event logs, kept for the few sessions read last
// (vscode-extension.md step 10.14). The audit and insights rollups call
// readSession on every session, and the web asks for a session, its turn
// details and its system prompt one after another; a log can be 17 MB, so
// re-parsing it each time would dominate. A live session's log grows, so an
// entry only holds while the file's size and mtime are unchanged.

export interface EventLogFileStamp {
  size: number;
  mtimeMs: number;
}

export type CopilotEventLogLoad =
  | { status: "read"; log: CopilotEventLog }
  | { status: "missing" }
  | { status: "unreadable"; error: unknown };

export interface CopilotEventLogCacheOptions {
  // null when the file doesn't exist; rejects on any other I/O error.
  read: (filePath: string) => Promise<CopilotEventLog | null>;
  stat: (filePath: string) => Promise<EventLogFileStamp | null>;
  maxEntries?: number;
}

// Enough for a session plus its inspector and system-prompt requests, and a
// rollup's working set, while bounding memory to a few parsed logs.
export const DEFAULT_EVENT_LOG_CACHE_ENTRIES = 4;

interface Entry {
  stamp: EventLogFileStamp;
  // Shared by concurrent loads, so one parse serves them all.
  load: Promise<CopilotEventLogLoad>;
}

function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export async function statEventLogFile(filePath: string): Promise<EventLogFileStamp | null> {
  try {
    const stats = await stat(filePath);
    return { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch (error) {
    if (isMissingPath(error)) {
      return null;
    }
    throw error;
  }
}

// Callers share the cached log, so they must treat it as read-only (the
// builders are pure).
export class CopilotEventLogCache {
  // Map order is recency: a hit is moved to the end, the first key is evicted.
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;

  constructor(private readonly options: CopilotEventLogCacheOptions) {
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_EVENT_LOG_CACHE_ENTRIES);
  }

  async load(filePath: string): Promise<CopilotEventLogLoad> {
    let stamp: EventLogFileStamp | null;
    try {
      stamp = await this.options.stat(filePath);
    } catch (error) {
      return { status: "unreadable", error };
    }
    if (stamp === null) {
      this.entries.delete(filePath);
      return { status: "missing" };
    }

    const cached = this.entries.get(filePath);
    if (cached && cached.stamp.size === stamp.size && cached.stamp.mtimeMs === stamp.mtimeMs) {
      this.entries.delete(filePath);
      this.entries.set(filePath, cached);
      return cached.load;
    }

    const load = this.parse(filePath);
    this.entries.delete(filePath);
    this.entries.set(filePath, { stamp, load });
    this.evictOverflow();
    const result = await load;
    // Only a parsed log is worth keeping; a failure is retried next time.
    if (result.status !== "read" && this.entries.get(filePath)?.load === load) {
      this.entries.delete(filePath);
    }
    return result;
  }

  // The stamp is taken before the read, so a file appended to meanwhile
  // reads as changed next time: stale entries are re-parsed, never kept.
  private async parse(filePath: string): Promise<CopilotEventLogLoad> {
    try {
      const log = await this.options.read(filePath);
      return log === null ? { status: "missing" } : { status: "read", log };
    } catch (error) {
      return { status: "unreadable", error };
    }
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }
}
