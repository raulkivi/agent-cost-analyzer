// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import type { FileKind, ReadOnlyFileSystem } from "../services/cost-attribution/read-only-file-system.js";

// A file tree from `{ "/abs/file": "content" }` plus explicit empty
// directories; every parent of a listed path is a directory. Counts reads so
// tests can check caching.
export class InMemoryFileSystem implements ReadOnlyFileSystem {
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>();
  reads = 0;
  lookups = 0;

  constructor(files: Record<string, string>, directories: string[] = []) {
    for (const [file, content] of Object.entries(files)) {
      this.files.set(path.resolve(file), content);
      this.addParents(path.resolve(file));
    }
    for (const dir of directories) {
      this.directories.add(path.resolve(dir));
      this.addParents(path.resolve(dir));
    }
  }

  private addParents(p: string): void {
    let dir = path.dirname(p);
    while (!this.directories.has(dir)) {
      this.directories.add(dir);
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }

  kindOf(p: string): FileKind | null {
    this.lookups += 1;
    const resolved = path.resolve(p);
    if (this.files.has(resolved)) {
      return "file";
    }
    return this.directories.has(resolved) ? "directory" : null;
  }

  readText(p: string, maxBytes: number): string | null {
    this.reads += 1;
    const content = this.files.get(path.resolve(p));
    if (content === undefined || Buffer.byteLength(content) > maxBytes) {
      return null;
    }
    return content;
  }
}
