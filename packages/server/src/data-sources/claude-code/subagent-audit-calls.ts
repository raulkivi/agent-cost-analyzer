// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ToolCallOrigin, ToolCallRecord } from "@agent-cost-analyzer/domain";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { extractToolCalls } from "./tool-call-extractor.js";
import { indexToolResults } from "./tool-result-index.js";

/**
 * One run transcript's tool calls, each carrying `origin` (CS14). The same
 * extractor and result index as the main agent's, so outcomes, redaction and
 * kinds are one rule. Calls whose id is in `counted` are skipped (a fork
 * repeats its parent's lines, CS D4); the ids this run keeps are added to it,
 * so the first log in read order owns an id (audit plan section 5.4).
 */
export function extractRunToolCalls(
  entries: readonly ClaudeCodeRawEntry[],
  origin: ToolCallOrigin,
  counted: Set<string>,
): ToolCallRecord[] {
  const all = [...entries];
  if (all.length === 0) return [];
  const calls = extractToolCalls({ userMessageEntry: all[0]!, entries: all }, indexToolResults(all));

  const kept: ToolCallRecord[] = [];
  for (const call of calls) {
    if (call.id !== undefined) {
      if (counted.has(call.id)) continue;
      counted.add(call.id);
    }
    kept.push({ ...call, origin });
  }
  return kept;
}
