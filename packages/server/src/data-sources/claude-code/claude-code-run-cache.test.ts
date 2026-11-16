// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { ClaudeCodeRunTranscriptCache, type RunFileStamp } from "./claude-code-run-cache.js";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";

const entries = (count: number): ClaudeCodeRawEntry[] => Array.from({ length: count }, () => ({ type: "assistant" }));

function setup(options: { maxFiles?: number; maxEntries?: number } = {}) {
  const stamps = new Map<string, RunFileStamp | null>();
  const reads: string[] = [];
  const sizes = new Map<string, number>();
  const cache = new ClaudeCodeRunTranscriptCache({
    stat: async (file) => stamps.get(file) ?? null,
    read: async (file) => {
      reads.push(file);
      if (sizes.get(file) === -1) throw new Error("boom");
      return entries(sizes.get(file) ?? 1);
    },
    ...options,
  });
  return { cache, stamps, reads, sizes };
}

describe("ClaudeCodeRunTranscriptCache", () => {
  it("reads an unchanged transcript once", async () => {
    const { cache, stamps, reads } = setup();
    stamps.set("/a", { size: 10, mtimeMs: 1 });

    await cache.load("/a");
    const second = await cache.load("/a");

    expect(reads).toEqual(["/a"]);
    expect(second.status).toBe("read");
  });

  it("reads again when the size or the mtime changes", async () => {
    const { cache, stamps, reads } = setup();
    stamps.set("/a", { size: 10, mtimeMs: 1 });
    await cache.load("/a");
    stamps.set("/a", { size: 11, mtimeMs: 1 });
    await cache.load("/a");
    stamps.set("/a", { size: 11, mtimeMs: 2 });
    await cache.load("/a");

    expect(reads).toHaveLength(3);
  });

  it("shares one read between concurrent loads", async () => {
    const { cache, stamps, reads } = setup();
    stamps.set("/a", { size: 10, mtimeMs: 1 });

    await Promise.all([cache.load("/a"), cache.load("/a")]);

    expect(reads).toHaveLength(1);
  });

  it("reports a vanished file as missing and an unreadable one as unreadable, keeping neither", async () => {
    const { cache, stamps, reads, sizes } = setup();

    expect(await cache.load("/gone")).toEqual({ status: "missing" });

    stamps.set("/bad", { size: 1, mtimeMs: 1 });
    sizes.set("/bad", -1);
    expect(await cache.load("/bad")).toEqual({ status: "unreadable" });
    await cache.load("/bad");
    expect(reads.filter((file) => file === "/bad")).toHaveLength(2);
  });

  it("evicts the least recently used file past the file bound", async () => {
    const { cache, stamps, reads } = setup({ maxFiles: 2 });
    for (const file of ["/a", "/b", "/c"]) stamps.set(file, { size: 1, mtimeMs: 1 });

    await cache.load("/a");
    await cache.load("/b");
    await cache.load("/a"); // a is now the most recent
    await cache.load("/c"); // evicts b
    await cache.load("/a");
    await cache.load("/b");

    expect(reads).toEqual(["/a", "/b", "/c", "/b"]);
  });

  it("bounds the kept lines and does not keep one transcript above the bound", async () => {
    const { cache, stamps, reads, sizes } = setup({ maxEntries: 10 });
    for (const file of ["/a", "/b", "/big"]) stamps.set(file, { size: 1, mtimeMs: 1 });
    sizes.set("/a", 6);
    sizes.set("/b", 6);
    sizes.set("/big", 11);

    await cache.load("/a");
    await cache.load("/b"); // 12 lines: evicts a
    await cache.load("/big");
    await cache.load("/big");
    await cache.load("/a");

    expect(reads).toEqual(["/a", "/b", "/big", "/big", "/a"]);
  });
});
