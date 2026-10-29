import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CopilotEventLog } from "./copilot-event.js";
import {
  CopilotEventLogCache,
  statEventLogFile,
  type EventLogFileStamp,
} from "./copilot-event-log-cache.js";

const log = (id: string): CopilotEventLog => ({
  events: [{ id, type: "user.message", parentId: null, timestamp: null, agentId: null, data: {} }],
  skippedLines: 0,
});

// A fake file system: each path has a stamp (or none, i.e. missing) and the
// log the reader returns for it.
function fakeFiles() {
  const stamps = new Map<string, EventLogFileStamp>();
  const read = vi.fn(async (filePath: string) => (stamps.has(filePath) ? log(filePath) : null));
  const stat = vi.fn(async (filePath: string) => stamps.get(filePath) ?? null);
  return { stamps, read, stat };
}

describe("CopilotEventLogCache", () => {
  it("parses a log once while its size and mtime are unchanged", async () => {
    const files = fakeFiles();
    files.stamps.set("/a", { size: 10, mtimeMs: 1 });
    const cache = new CopilotEventLogCache({ read: files.read, stat: files.stat });

    const first = await cache.load("/a");
    const second = await cache.load("/a");

    expect(first).toEqual({ status: "read", log: log("/a") });
    expect(second).toBe(first);
    expect(files.read).toHaveBeenCalledTimes(1);
  });

  it("re-parses a log whose size or mtime changed (a live session appends to it)", async () => {
    const files = fakeFiles();
    files.stamps.set("/a", { size: 10, mtimeMs: 1 });
    const cache = new CopilotEventLogCache({ read: files.read, stat: files.stat });

    await cache.load("/a");
    files.stamps.set("/a", { size: 20, mtimeMs: 1 });
    await cache.load("/a");
    files.stamps.set("/a", { size: 20, mtimeMs: 2 });
    await cache.load("/a");

    expect(files.read).toHaveBeenCalledTimes(3);
  });

  it("is missing, without reading, when the file doesn't exist", async () => {
    const files = fakeFiles();
    const cache = new CopilotEventLogCache({ read: files.read, stat: files.stat });

    await expect(cache.load("/none")).resolves.toEqual({ status: "missing" });
    expect(files.read).not.toHaveBeenCalled();
  });

  it("is missing when the file disappears between stat and read", async () => {
    const files = fakeFiles();
    const cache = new CopilotEventLogCache({
      read: async () => null,
      stat: async () => ({ size: 1, mtimeMs: 1 }),
    });

    await expect(cache.load("/gone")).resolves.toEqual({ status: "missing" });
    expect(files.read).not.toHaveBeenCalled();
  });

  it("is unreadable when the reader rejects, and tries again next time", async () => {
    const error = Object.assign(new Error("denied"), { code: "EACCES" });
    const read = vi.fn<(filePath: string) => Promise<CopilotEventLog | null>>().mockRejectedValueOnce(error).mockResolvedValueOnce(log("/a"));
    const cache = new CopilotEventLogCache({ read, stat: async () => ({ size: 1, mtimeMs: 1 }) });

    await expect(cache.load("/a")).resolves.toEqual({ status: "unreadable", error });
    await expect(cache.load("/a")).resolves.toEqual({ status: "read", log: log("/a") });
  });

  it("is unreadable when stat fails for a reason other than a missing file", async () => {
    const error = Object.assign(new Error("denied"), { code: "EACCES" });
    const cache = new CopilotEventLogCache({ read: async () => log("/a"), stat: async () => Promise.reject(error) });

    await expect(cache.load("/a")).resolves.toEqual({ status: "unreadable", error });
  });

  it("keeps only the most recently used logs", async () => {
    const files = fakeFiles();
    for (const name of ["/a", "/b", "/c"]) files.stamps.set(name, { size: 1, mtimeMs: 1 });
    const cache = new CopilotEventLogCache({ read: files.read, stat: files.stat, maxEntries: 2 });

    await cache.load("/a");
    await cache.load("/b");
    await cache.load("/a"); // /a is now the most recent, so /b goes next
    await cache.load("/c");
    files.read.mockClear();

    await cache.load("/a");
    expect(files.read).not.toHaveBeenCalled();
    await cache.load("/b");
    expect(files.read).toHaveBeenCalledTimes(1);
  });

  it("shares one parse between concurrent loads of the same log", async () => {
    const files = fakeFiles();
    files.stamps.set("/a", { size: 1, mtimeMs: 1 });
    const cache = new CopilotEventLogCache({ read: files.read, stat: files.stat });

    const [first, second] = await Promise.all([cache.load("/a"), cache.load("/a")]);

    expect(second).toEqual(first);
    expect(files.read).toHaveBeenCalledTimes(1);
  });
});

describe("statEventLogFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "event-log-stat-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives a file's size and mtime", async () => {
    const file = path.join(dir, "events.jsonl");
    writeFileSync(file, "{}\n");

    const stamp = await statEventLogFile(file);

    expect(stamp?.size).toBe(3);
    expect(stamp?.mtimeMs).toBeGreaterThan(0);
  });

  it("is null for a missing file or a path through a file", async () => {
    writeFileSync(path.join(dir, "file"), "");
    mkdirSync(path.join(dir, "empty"));

    await expect(statEventLogFile(path.join(dir, "empty", "events.jsonl"))).resolves.toBeNull();
    await expect(statEventLogFile(path.join(dir, "file", "events.jsonl"))).resolves.toBeNull();
  });
});
