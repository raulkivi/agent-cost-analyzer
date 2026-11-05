import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import type { FileKind, ReadOnlyFileSystem } from "../../services/cost-attribution/read-only-file-system.js";

// The Node implementation of the resolver's file port (Phase 15 step 15.2).
// Read-only by construction: it stats and reads, never writes. A file is
// read only if its size is within the limit, checked on the open handle so
// a file swapped after the check can't be read past it.
export class NodeReadOnlyFileSystem implements ReadOnlyFileSystem {
  kindOf(path: string): FileKind | null {
    try {
      const stats = statSync(path);
      return stats.isDirectory() ? "directory" : stats.isFile() ? "file" : null;
    } catch {
      return null;
    }
  }

  readText(path: string, maxBytes: number): string | null {
    let fd: number | null = null;
    try {
      fd = openSync(path, "r");
      const stats = fstatSync(fd);
      if (!stats.isFile() || stats.size > maxBytes) {
        return null;
      }
      const buffer = Buffer.alloc(stats.size);
      const read = readSync(fd, buffer, 0, stats.size, 0);
      return buffer.subarray(0, read).toString("utf-8");
    } catch {
      return null;
    } finally {
      if (fd !== null) {
        closeSync(fd);
      }
    }
  }
}
