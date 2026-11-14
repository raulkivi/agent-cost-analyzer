// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createReadStream, existsSync } from "node:fs";

// Generic line shape for Claude Code CLI's own JSONL session format
// (confirmed against real captures under ~/.claude/projects on this
// machine, not from published docs): every line is one node of a
// `uuid`/`parentUuid` tree — forks happen on message-edit/resend, not an
// append-only flat history. Unlike pi's format there is no separate
// "session" header line; per-session metadata (`cwd`, `gitBranch`, `slug`,
// `sessionId`, ...) rides on ordinary entries instead (see title-resolver.ts
// and session-tree.ts). Deliberately loose beyond `type`/`uuid`/
// `parentUuid` — defensive, version-tolerant parsing, same posture as
// pi-jsonl-reader.ts, since per-type payload shape (`message`, `usage`,
// `attachment`, `toolUseResult`, ...) isn't re-validated here, only carried
// through to the stage that knows what it needs.
export interface ClaudeCodeRawEntry {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  [key: string]: unknown;
}

export function parseClaudeCodeJsonlLine(line: string): ClaudeCodeRawEntry | null {
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
      return parsed as ClaudeCodeRawEntry;
    }
    return null;
  } catch {
    return null;
  }
}

export interface ClaudeCodeSessionReadResult {
  entries: ClaudeCodeRawEntry[];
  rawLineCount: number;
}

// Streams the file line-by-line (never fully buffered), mirroring
// pi-jsonl-reader.ts's readPiSessionFile — files under ~/.claude/projects
// range 1.6KB-31MB (median 336KB) per the plan's real-capture survey, so
// whole-file parsing isn't an option. Malformed lines are counted in
// rawLineCount but otherwise skipped, never thrown.
export async function readClaudeCodeSessionFile(filePath: string): Promise<ClaudeCodeSessionReadResult> {
  if (!existsSync(filePath)) {
    return { entries: [], rawLineCount: 0 };
  }

  const entries: ClaudeCodeRawEntry[] = [];
  let rawLineCount = 0;

  const take = (line: string) => {
    if (!line.trim()) {
      return;
    }
    rawLineCount += 1;

    const parsed = parseClaudeCodeJsonlLine(line);
    if (parsed) {
      entries.push(parsed);
    }
  };

  // A record ends at "\n" only (a "\r" before it is trimmed by the parser).
  // readline would also split at U+2028, U+2029 and a lone "\r", which
  // JSON.stringify leaves raw inside strings, tearing a record in two.
  let carry = "";
  for await (const chunk of createReadStream(filePath, "utf-8")) {
    const lines = (carry + chunk).split("\n");
    carry = lines.pop() ?? "";
    lines.forEach(take);
  }
  take(carry);

  return { entries, rawLineCount };
}
