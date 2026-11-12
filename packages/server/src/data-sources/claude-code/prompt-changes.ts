// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import type { PromptChangeMarker } from "@agent-cost-analyzer/domain";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import type { ClaudeCodeRound } from "./round-grouper.js";

// Phase 16 SR6 (docs/plans/savings-report.md §4 O3, §15 d): what changed in
// each request's prompt since the previous request of the same `querySource`
// (the cache follows one agent's prompt, and sub-agents and the compactor
// have their own), from the two signals Claude Code's log records:
//   - `api-request.shapeHash` changed: the tool list changed (541 of 542
//     shape changes in the SR0 survey were tool-list-only);
//   - the `instructions` attachment (`files[]`) in force changed.
// The system prompt is not recorded. Only hashes are compared; no file text
// or path is kept.

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function instructionsSignature(entry: ClaudeCodeRawEntry): string | undefined {
  if (entry.type !== "attachment") return undefined;
  const attachment = recordOf(entry.attachment);
  if (attachment?.type !== "instructions" || !Array.isArray(attachment.files)) return undefined;
  return digest(attachment.files.map((file) => [recordOf(file)?.path, recordOf(file)?.content]));
}

interface RequestFacts {
  querySource: string;
  shapeHash: string | undefined;
  instructions: string | undefined;
}

export interface ClaudeCodePromptChangeInput {
  // The request's rounds, in trace order (request index = position).
  rounds: readonly ClaudeCodeRound[];
  // The active branch, in order: where the `instructions` attachments sit.
  branch: readonly ClaudeCodeRawEntry[];
  // Every line of the file: `api-request` lines are not part of the branch.
  entries: readonly ClaudeCodeRawEntry[];
}

export function buildClaudeCodePromptChanges({ rounds, branch, entries }: ClaudeCodePromptChangeInput): Map<number, PromptChangeMarker> {
  const requests = new Map<string, { querySource: string; shapeHash: string | undefined }>();
  for (const entry of entries) {
    if (entry.type !== "api-request" || typeof entry.id !== "string" || typeof entry.querySource !== "string") continue;
    requests.set(entry.id, { querySource: entry.querySource, shapeHash: typeof entry.shapeHash === "string" ? entry.shapeHash : undefined });
  }
  // The instructions in force at each branch entry.
  const instructionsAt = new Map<ClaudeCodeRawEntry, string | undefined>();
  let current: string | undefined;
  for (const entry of branch) {
    current = instructionsSignature(entry) ?? current;
    instructionsAt.set(entry, current);
  }

  const result = new Map<number, PromptChangeMarker>();
  const previousBySource = new Map<string, RequestFacts>();
  rounds.forEach((round, index) => {
    const entry = round.entries[0];
    const ref = round.entries.map((candidate) => candidate.requestRef).find((value): value is string => typeof value === "string");
    const request = ref === undefined ? undefined : requests.get(ref);
    if (entry === undefined || request === undefined) return;
    const facts: RequestFacts = { querySource: request.querySource, shapeHash: request.shapeHash, instructions: instructionsAt.get(entry) };
    const previous = previousBySource.get(facts.querySource);
    previousBySource.set(facts.querySource, facts);
    if (previous === undefined) return;
    const marker: PromptChangeMarker = {};
    if (facts.shapeHash !== undefined && previous.shapeHash !== undefined) marker.tools = facts.shapeHash !== previous.shapeHash;
    if (facts.instructions !== undefined && previous.instructions !== undefined) marker.instructions = facts.instructions !== previous.instructions;
    if (Object.keys(marker).length > 0) result.set(index, marker);
  });
  return result;
}
