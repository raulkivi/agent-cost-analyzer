// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { knownWorkspace, unknownWorkspace } from "@agent-cost-analyzer/domain";
import type { KnownSessionWorkspace, SessionWorkspace } from "@agent-cost-analyzer/domain";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";

// Phase 15 step 15.1 (docs/plans/cost-by-repository-and-project.md §4.1).
// Claude Code records `cwd`, `gitBranch` and `timestamp` on every user,
// assistant, system and attachment entry (checked against a real session
// log on 2026-11-05). The folder can change mid-session — the shell moves
// between folders — so a turn carries its own workspace where it differs.
export const CLAUDE_CODE_NO_FOLDER_REASON = "This Claude Code session's entries record no working folder.";

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function entryWorkspace(entry: ClaudeCodeRawEntry): KnownSessionWorkspace | null {
  return knownWorkspace(text(entry.cwd), { branch: text(entry.gitBranch) });
}

// The first entry, in branch order, that records a folder.
export function resolveSessionWorkspace(entries: readonly ClaudeCodeRawEntry[]): SessionWorkspace {
  for (const entry of entries) {
    const workspace = entryWorkspace(entry);
    if (workspace) {
      return workspace;
    }
  }
  return unknownWorkspace(CLAUDE_CODE_NO_FOLDER_REASON);
}

function sameWorkspace(a: KnownSessionWorkspace, b: SessionWorkspace): boolean {
  return b.known && a.cwd === b.cwd && a.branch === b.branch;
}

// Only where the turn's user message ran elsewhere than the session.
export function resolveTurnWorkspace(group: ClaudeCodeTurnGroup, session: SessionWorkspace): KnownSessionWorkspace | undefined {
  const workspace = entryWorkspace(group.userMessageEntry);
  return workspace && !sameWorkspace(workspace, session) ? workspace : undefined;
}

export function resolveTurnStartedAt(group: ClaudeCodeTurnGroup): string | undefined {
  return text(group.userMessageEntry.timestamp) || undefined;
}
