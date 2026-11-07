// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";

export interface ClaudeCodeTurnGroup {
  userMessageEntry: ClaudeCodeRawEntry;
  entries: ClaudeCodeRawEntry[];
}

function messageOf(entry: ClaudeCodeRawEntry): Record<string, unknown> | null {
  return typeof entry.message === "object" && entry.message !== null
    ? (entry.message as Record<string, unknown>)
    : null;
}

// Load-bearing: `type: "user"` is shared by two very different things in
// Claude Code's format — a genuine human turn (message.content is a string,
// or an array containing at least one non-tool_result block, typically
// `{ type: "text" }`) and a tool-result-delivery line the CLI itself writes
// back after running a tool call (message.content is an array of purely
// `tool_result` blocks). Only the former should open a new turn. Two more
// CLI-written `user` lines are never a human message either (both confirmed
// against real captures): `isMeta: true` text the CLI injects itself (a
// local command's caveat, a skill's body — splitting a turn on one would
// split one response, one message.id, across two turns), and a compaction's
// summary (`isCompactSummary: true`, right after its compact_boundary entry).
export function isRealUserMessage(entry: ClaudeCodeRawEntry): boolean {
  if (entry.type !== "user" || entry.isMeta === true || entry.isCompactSummary === true) {
    return false;
  }
  const content = messageOf(entry)?.content;
  if (typeof content === "string") {
    return true;
  }
  if (Array.isArray(content)) {
    return content.some(
      (block) => !(typeof block === "object" && block !== null && (block as { type?: unknown }).type === "tool_result"),
    );
  }
  return false;
}

// Groups one branch's linear entry list (session-tree.ts's walkBranch
// output) into turns: everything from a real user message up to (not
// including) the next real user message belongs to that turn — same
// algorithm as pi-agent/turn-grouper.ts's groupBranchEntriesByUserMessage,
// gated by isRealUserMessage instead of pi's isUserMessage so a
// tool-result-delivery line never starts a new turn. Entries before the
// first real user message have no turn to belong to and are dropped. A
// compaction's boundary and summary therefore stay in the turn they were
// written in (the one before it, or the same one for a compaction mid-turn).
export function groupBranchEntriesByUserMessage(branchEntries: ClaudeCodeRawEntry[]): ClaudeCodeTurnGroup[] {
  const groups: ClaudeCodeTurnGroup[] = [];

  for (const entry of branchEntries) {
    if (isRealUserMessage(entry)) {
      groups.push({ userMessageEntry: entry, entries: [entry] });
      continue;
    }
    groups.at(-1)?.entries.push(entry);
  }

  return groups;
}
