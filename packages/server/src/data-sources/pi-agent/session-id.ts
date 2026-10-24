import { statSync } from "node:fs";
import crypto from "node:crypto";

const BRANCH_MARKER = "__branch__";

// A stable hash of one session file's path + mtime, same reasoning as
// mitmproxy's computeHarSessionId: the same unmodified file always resolves
// to the same hash, and an overwritten file at the same path gets a fresh
// one rather than reusing stale content.
export function computePiFileHash(filePath: string): string {
  const stats = statSync(filePath);
  return crypto.createHash("sha256").update(`${filePath}:${stats.mtimeMs}`).digest("hex").slice(0, 16);
}

// A composite id addressing one branch (leaf) of one session file:
// `<computePiFileHash(filePath)>__branch__<leafEntryId>`. Unlike mitmproxy's
// numeric segment index, pi's leaf ids are its own entry ids (typically
// uuids, which contain hyphens), so a plain "-" separator would be ambiguous
// — `__branch__` is used instead, since computePiFileHash's output is a
// fixed lowercase-hex slice that can never contain it.
export function computeBranchSessionId(filePath: string, leafId: string): string {
  return `${computePiFileHash(filePath)}${BRANCH_MARKER}${leafId}`;
}

export interface ParsedBranchSessionId {
  fileHash: string;
  leafId: string;
}

export function parseBranchSessionId(sessionId: string): ParsedBranchSessionId | null {
  const markerIndex = sessionId.indexOf(BRANCH_MARKER);
  if (markerIndex === -1) {
    return null;
  }
  const fileHash = sessionId.slice(0, markerIndex);
  const leafId = sessionId.slice(markerIndex + BRANCH_MARKER.length);
  if (!fileHash || !leafId) {
    return null;
  }
  return { fileHash, leafId };
}
