import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

// Structural mirror of packages/pi-system-prompt-logger's own
// SystemPromptRecord — deliberately duplicated, not imported.
// packages/server has no runtime dependency on
// packages/pi-system-prompt-logger (architecture.md §6.2.5): this is a
// JSONL wire format on disk, not a shared TS API, the same posture
// pi-jsonl-reader.ts already takes toward pi's own session format.
export interface PiSystemPromptSidecarRecord {
  sessionId: string;
  sessionFile?: string;
  capturedAt: string;
  cwd: string;
  provider?: string;
  modelId?: string;
  systemPromptChars: number;
  systemPrompt: string;
  selectedTools?: string[];
  skillNames?: string[];
  contextFilePaths?: string[];
}

function isSidecarRecord(value: unknown): value is PiSystemPromptSidecarRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.sessionId === "string" &&
    typeof v.capturedAt === "string" &&
    typeof v.cwd === "string" &&
    typeof v.systemPromptChars === "number" &&
    typeof v.systemPrompt === "string"
  );
}

export function parseSidecarLine(
  line: string,
): PiSystemPromptSidecarRecord | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isSidecarRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Keyed by the record's resolved `sessionFile` absolute path — the only
// reliable join key. The sidecar's own `sessionId` (pi's
// ctx.sessionManager.getSessionId()) vs. a session file's own header.id are
// an unconfirmed equivalence (no real capture obtained yet); `sessionFile`
// is a plain path this provider can compare directly against the file
// paths it already resolves itself. Records with no `sessionFile` can never
// be joined and are skipped, not stored under a synthetic key.
export type SidecarIndex = Map<string, PiSystemPromptSidecarRecord>;

// Streams the file (never fully buffered), mirroring readPiSessionFile.
// Keeps the EARLIEST record per resolved sessionFile when duplicates exist
// (first-seen-wins, since the file is append-only) — a known
// simplification pending real-data verification: a forked/rewound pi
// session shares one file across multiple Session branches in this app,
// and the extension captures the system prompt once per session before any
// fork existed, so "earliest wins" is the closest available approximation
// until a real multi-branch capture confirms the right behavior.
export async function readSystemPromptSidecarIndex(
  filePath: string | null | undefined,
): Promise<SidecarIndex> {
  const index: SidecarIndex = new Map();
  if (!filePath || !existsSync(filePath)) {
    return index;
  }

  const lines = createInterface({
    input: createReadStream(filePath, "utf-8"),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const record = parseSidecarLine(line);
    if (!record || !record.sessionFile) {
      continue;
    }
    const key = path.resolve(record.sessionFile);
    if (!index.has(key)) {
      index.set(key, record);
    }
  }
  return index;
}
