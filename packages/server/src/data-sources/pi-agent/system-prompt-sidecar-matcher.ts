// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import type { PiSystemPromptSidecarRecord } from "./system-prompt-sidecar-reader.js";

function millis(timestamp: unknown): number {
  return typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
}

// Latest parsable entry timestamp on the branch: the in-file prompt is the
// state at the end of the branch, so this is the point to match against.
export function branchEndTimestamp(branch: PiRawEntry[]): string | undefined {
  let best: { ms: number; text: string } | undefined;
  for (const entry of branch) {
    const ms = millis(entry.timestamp);
    if (!Number.isNaN(ms) && (best === undefined || ms > best.ms)) {
      best = { ms, text: entry.timestamp as string };
    }
  }
  return best?.text;
}

// A session file can have several sidecar records (one per model or prompt
// change). The right one is the latest captured at or before the branch's
// end: records captured later belong to a later point or another branch.
// When none qualifies, or the branch has no timestamps, the earliest record
// is used (the original behaviour).
export function selectSidecarRecord(
  records: readonly PiSystemPromptSidecarRecord[] | undefined,
  branchEndedAt: string | undefined,
): PiSystemPromptSidecarRecord | undefined {
  if (!records || records.length === 0) {
    return undefined;
  }
  const dated = records
    .map((record) => ({ record, ms: millis(record.capturedAt) }))
    .filter((item) => !Number.isNaN(item.ms))
    .sort((a, b) => a.ms - b.ms);
  if (dated.length === 0) {
    return records[0];
  }
  const endMs = millis(branchEndedAt);
  if (Number.isNaN(endMs)) {
    return dated[0].record;
  }
  const upToEnd = dated.filter((item) => item.ms <= endMs);
  return (upToEnd.length > 0 ? upToEnd[upToEnd.length - 1] : dated[0]).record;
}
