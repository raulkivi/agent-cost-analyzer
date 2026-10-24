import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

// Generic line shape for pi's JSONL session format
// (https://pi.dev/docs/latest/session-format): every line beyond the header
// carries `id`/`parentId` because the file is an append-only serialization of
// a tree (forks/rewinds), not a flat list. Deliberately loose beyond `type` —
// defensive, version-tolerant parsing, same posture as main-jsonl-reader.ts,
// since the per-type payload shape (`message`, usage, etc.) isn't re-validated
// here, only carried through to the extraction stage that knows what it needs.
export interface PiSessionHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface PiRawEntry {
  type: string;
  id?: string;
  parentId?: string;
  [key: string]: unknown;
}

function isSessionHeader(value: { type: string }): value is PiSessionHeader {
  return (
    value.type === "session" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { cwd?: unknown }).cwd === "string"
  );
}

export function parsePiJsonlLine(line: string): PiSessionHeader | PiRawEntry | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { type?: unknown }).type === "string"
    ) {
      const withType = parsed as { type: string };
      return isSessionHeader(withType) ? withType : (withType as PiRawEntry);
    }
    return null;
  } catch {
    return null;
  }
}

export interface PiSessionReadResult {
  header: PiSessionHeader | null;
  entries: PiRawEntry[];
  rawLineCount: number;
}

// Streams the file line-by-line (never fully buffered), mirroring
// main-jsonl-reader.ts's readMainJsonlFile. The first `type: "session"` line
// becomes `header`; every other recognized line becomes an entry. Malformed
// lines are counted in rawLineCount but otherwise skipped, never thrown.
export async function readPiSessionFile(filePath: string): Promise<PiSessionReadResult> {
  if (!existsSync(filePath)) {
    return { header: null, entries: [], rawLineCount: 0 };
  }

  let header: PiSessionHeader | null = null;
  const entries: PiRawEntry[] = [];
  let rawLineCount = 0;

  const lines = createInterface({
    input: createReadStream(filePath, "utf-8"),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    rawLineCount += 1;

    const parsed = parsePiJsonlLine(line);
    if (!parsed) {
      continue;
    }
    if (parsed.type === "session" && !header) {
      header = parsed as PiSessionHeader;
    } else {
      entries.push(parsed as PiRawEntry);
    }
  }

  return { header, entries, rawLineCount };
}
