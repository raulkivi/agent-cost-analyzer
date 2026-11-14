// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import path from "node:path";
import { readRecordLines } from "../../platform/files/read-record-lines.js";

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

// Keyed by the record's resolved `sessionFile` absolute path. The record's
// `sessionId` equals the session header's id (Phase 11 generated sessions,
// pi 1.5.2), but `sessionFile` is a plain path this provider can compare
// directly against the file paths it already resolves.
// Records with no `sessionFile` can never be joined and are skipped.
// A session can have several records (model or prompt changes), kept in
// capturedAt order; system-prompt-sidecar-matcher.ts picks the right one.
export type SidecarIndex = Map<string, PiSystemPromptSidecarRecord[]>;

// Streams the file (never fully buffered), mirroring readPiSessionFile.
export async function readSystemPromptSidecarIndex(
  filePath: string | null | undefined,
): Promise<SidecarIndex> {
  const index: SidecarIndex = new Map();
  if (!filePath || !existsSync(filePath)) {
    return index;
  }

  for await (const line of readRecordLines(filePath)) {
    const record = parseSidecarLine(line);
    if (!record || !record.sessionFile) {
      continue;
    }
    const key = path.resolve(record.sessionFile);
    const records = index.get(key);
    if (records) {
      records.push(record);
    } else {
      index.set(key, [record]);
    }
  }
  for (const records of index.values()) {
    // Stable: file order breaks ties and unparsable dates.
    records.sort((a, b) => (Date.parse(a.capturedAt) || 0) - (Date.parse(b.capturedAt) || 0));
  }
  return index;
}
