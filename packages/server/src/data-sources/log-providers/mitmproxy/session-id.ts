import { statSync } from "node:fs";
import crypto from "node:crypto";

// A stable hash of one capture file's path + mtime — the same unmodified
// file always resolves to the same hash across restarts, and a
// re-exported/overwritten file at the same path gets a fresh hash rather
// than silently reusing stale content. A file may split into more than one
// session (see computeSegmentSessionId below); this hash identifies the
// file, not a session by itself.
export function computeHarSessionId(filePath: string): string {
  const stats = statSync(filePath);
  return crypto.createHash("sha256").update(`${filePath}:${stats.mtimeMs}`).digest("hex").slice(0, 16);
}

// A composite id addressing one idle-gap-split segment of one capture file:
// `<computeHarSessionId(filePath)>-<segmentIndex>`. Plain string
// concatenation, not a second hash — computeHarSessionId's output is a
// fixed 16-char lowercase-hex sha256 slice, which can never itself contain
// "-", so parseSegmentSessionId can split on the *last* "-" and
// unambiguously recover both parts without reading any file content,
// preserving readSession's/readTurnDetail's cheap stat-only file lookup.
export function computeSegmentSessionId(filePath: string, segmentIndex: number): string {
  return `${computeHarSessionId(filePath)}-${segmentIndex}`;
}

export interface ParsedSegmentSessionId {
  fileHash: string;
  segmentIndex: number;
}

// Rejects anything not shaped like <hash>-<non-negative integer> — e.g. a
// stale/foreign id or a hand-typed unknown id like "does-not-exist" — by
// returning null rather than throwing, so callers can short-circuit
// straight to the LogProvider contract's "unknown id -> null" behavior
// before touching the filesystem at all.
export function parseSegmentSessionId(sessionId: string): ParsedSegmentSessionId | null {
  const separatorIndex = sessionId.lastIndexOf("-");
  if (separatorIndex === -1) {
    return null;
  }
  const fileHash = sessionId.slice(0, separatorIndex);
  const segmentIndexPart = sessionId.slice(separatorIndex + 1);
  if (!/^\d+$/.test(segmentIndexPart)) {
    return null;
  }
  return { fileHash, segmentIndex: Number(segmentIndexPart) };
}
