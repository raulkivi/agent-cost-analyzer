// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ContextEdit } from "@agent-cost-analyzer/domain";
import type { PiRawEntry } from "./pi-jsonl-reader.js";

// pi's `context_edit` entry (vendored docs/session-format.md
// "ContextEditEntry"): an append-only edit of one earlier user, assistant,
// tool-result or custom-message entry. It changes only what later requests
// send to the model; the target stays in raw history and in pi's own usage
// totals. `replacement: null` omits the target; anything else replaces its
// content. pi 1.5.2 appends omissions itself when it recovers from a
// truncated or overflowing response (docs/compaction.md "Overflow and Length
// Recovery Ordering").
export interface PiContextEdit {
  replacement: unknown;
}

// The latest edit per target along one branch wins, as in pi's
// buildSessionProjection. Edits are branch-relative, so callers pass the
// branch, never the whole file.
export function latestContextEdits(branch: PiRawEntry[]): Map<string, PiContextEdit> {
  const edits = new Map<string, PiContextEdit>();
  for (const entry of branch) {
    if (entry.type === "context_edit" && typeof entry.targetId === "string") {
      edits.set(entry.targetId, { replacement: entry.replacement ?? null });
    }
  }
  return edits;
}

export function contextEditFor(edit: PiContextEdit, what: "response" | "tool result"): ContextEdit {
  return edit.replacement === null
    ? {
        kind: "omitted",
        note: `pi left this ${what} out of the model's context for every later request (context_edit), as it does after a truncated or overflowing response. Its tokens still count.`,
      }
    : {
        kind: "replaced",
        note: `pi replaced this ${what} in the model's context for every later request (context_edit). Later requests saw the replacement; its tokens still count as logged.`,
      };
}
