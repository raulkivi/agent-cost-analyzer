import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { groupTurnRequestRounds } from "./round-grouper.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";

// A Claude Code compaction (manual `/compact` or automatic) writes a
// `system` entry with subtype "compact_boundary" (parentUuid null, the
// last entry before it in logicalParentUuid, see session-tree.ts), then a
// `user` entry with isCompactSummary holding the summary (turn-grouper.ts).
// Confirmed against real captures.
export function isCompactBoundary(entry: ClaudeCodeRawEntry): boolean {
  return entry.type === "system" && entry.subtype === "compact_boundary";
}

function assistantMessageIdOf(entry: ClaudeCodeRawEntry): string | undefined {
  const message = entry.type === "assistant" && typeof entry.message === "object" && entry.message !== null ? (entry.message as { id?: unknown }) : undefined;
  return typeof message?.id === "string" ? message.id : undefined;
}

// The message.id of the first LLM request after each compaction boundary,
// read across the turns in order, so a compaction between turns names the
// next turn's first request and one mid-turn names the next request in the
// same turn. Synthetic rounds (no request) are skipped, as is a later block
// of a response that began before the boundary. A boundary with no request
// after it names nothing.
export function findCompactedRequestIds(groups: ClaudeCodeTurnGroup[]): Set<string> {
  const compacted = new Set<string>();
  const seen = new Set<string>();
  let pending = false;
  for (const group of groups) {
    const requestIds = new Set(groupTurnRequestRounds(group.entries).map((round) => round.messageId));
    for (const entry of group.entries) {
      if (isCompactBoundary(entry)) {
        pending = true;
        continue;
      }
      const id = assistantMessageIdOf(entry);
      if (id === undefined || seen.has(id) || !requestIds.has(id)) {
        continue;
      }
      seen.add(id);
      if (pending) {
        compacted.add(id);
        pending = false;
      }
    }
  }
  return compacted;
}
