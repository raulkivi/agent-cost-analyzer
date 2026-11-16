// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import { subagentRunIdSchema } from "@agent-cost-analyzer/domain";
import { readRecordLines } from "../../platform/files/read-record-lines.js";
import { parseClaudeCodeJsonlLine, type ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { isRunTimestamp } from "./subagent-run-usage.js";

// A run's transcript is read for numbers and ids only (plan section 5.2):
// `type`, `message.id`, `message.model`, `message.usage`, `requestId`,
// `timestamp` and `agentId`. Prompts, tool input and output never leave the
// line parser, so the run-summary cache holds nothing sensitive and little
// memory however long the transcript is.

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null;

/** The kept fields of one transcript line. */
export function slimRunEntry(entry: Raw): ClaudeCodeRawEntry {
  const slim: ClaudeCodeRawEntry = { type: typeof entry.type === "string" ? entry.type : "unknown" };
  for (const key of ["requestId", "timestamp", "agentId"]) {
    if (typeof entry[key] === "string") slim[key] = entry[key];
  }
  const message = entry.message;
  if (slim.type === "assistant" && isRecord(message)) {
    slim.message = {
      ...(typeof message.id === "string" ? { id: message.id } : {}),
      ...(typeof message.model === "string" ? { model: message.model } : {}),
      ...(isRecord(message.usage) ? { usage: message.usage } : {}),
    };
  }
  return slim;
}

/**
 * Streams a run's transcript line by line and keeps the slim form of each
 * parsable line. Lines that are not assistant rounds only ever supply the
 * run's first timestamp and first agent id, so they are dropped once both are
 * known: the sums and the placement read the same figures as from full lines.
 * A truncated last line (a live run) is skipped.
 */
export async function readSubagentTranscript(filePath: string): Promise<ClaudeCodeRawEntry[]> {
  if (!existsSync(filePath)) return [];

  const entries: ClaudeCodeRawEntry[] = [];
  let hasTimestamp = false;
  let hasAgentId = false;
  for await (const line of readRecordLines(filePath)) {
    const parsed = parseClaudeCodeJsonlLine(line);
    if (parsed === null) continue;

    const slim = slimRunEntry(parsed);
    const timestamp = typeof slim.timestamp === "string" && isRunTimestamp(slim.timestamp);
    const agentId = typeof slim.agentId === "string" && subagentRunIdSchema.safeParse(slim.agentId).success;
    const supplies = (timestamp && !hasTimestamp) || (agentId && !hasAgentId);
    hasTimestamp ||= timestamp;
    hasAgentId ||= agentId;
    if (slim.type === "assistant" || supplies) entries.push(slim);
  }
  return entries;
}
