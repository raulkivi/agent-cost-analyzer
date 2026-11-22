// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { messageOf } from "./pi-message.js";
import type { PiRawEntry } from "./pi-jsonl-reader.js";

// D27 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/savings-increment-3.md §7.4): each leaf of a pi file is its own session
// holding the whole root-to-leaf path, so a prefix two branches share appears
// in both. The first branch in leaf order owns it; this counts, for a later
// branch, the assistant requests in the leading entries an earlier branch of
// the same file also holds. `branch` is the branch's own entries (root first);
// `earlierBranches` the branches before it in leaf order. Like the turn
// grouper, requests before the first user message are not counted.
export function sharedPrefixRequests(branch: readonly PiRawEntry[], earlierBranches: readonly (readonly PiRawEntry[])[]): number {
  const earlier = new Set(earlierBranches.flatMap((entries) => entries.map((entry) => entry.id).filter((id): id is string => typeof id === "string")));
  let requests = 0;
  let inTurns = false;
  for (const entry of branch) {
    if (typeof entry.id !== "string" || !earlier.has(entry.id)) break;
    const message = messageOf(entry);
    inTurns ||= message?.role === "user";
    if (inTurns && message?.role === "assistant") requests += 1;
  }
  return requests;
}
