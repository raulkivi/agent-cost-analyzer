// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { subagentRunIdSchema, unavailableTokenCount, type SubagentRunUsage } from "@agent-cost-analyzer/domain";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { groupTurnRequestRounds, type ClaudeCodeRound } from "./round-grouper.js";
import { modelOf, sumRoundUsage } from "./round-usage.js";
import type { SubagentMeta } from "./subagent-meta.js";

const NO_AI_CREDITS_REASON =
  "AI Credits are GitHub Copilot's own billing unit — a Claude Code CLI session has no AI Credits conversion.";

// Same shape as the domain's `startedAt` (z.string().datetime(): UTC, Z suffix).
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * A run's own figures. `id` is the transcript's `agentId` (absent when no line
 * carries one) and `attribution` is the linker's call, so both are left to the
 * caller (subagent-attribution.ts).
 */
export type ClaudeCodeRunUsage = Omit<SubagentRunUsage, "id" | "attribution"> & { id?: string };

export interface ClaudeCodeRunUsageResult {
  usage: ClaudeCodeRunUsage;
  /**
   * `message.id` and `requestId` of every round this run counted. A fork's
   * children skip these (nested fork, plan section 13.2).
   */
  requestIds: Set<string>;
}

function requestIdOf(round: ClaudeCodeRound): string | undefined {
  for (const entry of round.entries) {
    if (typeof entry.requestId === "string") return entry.requestId;
  }
  return undefined;
}

// A fork repeats rounds of its parent verbatim (same message.id and requestId);
// those were billed once, on the parent, so the run must not count them again.
function isParentCopy(round: ClaudeCodeRound, parentRequestIds: ReadonlySet<string>): boolean {
  const requestId = requestIdOf(round);
  return parentRequestIds.has(round.messageId) || (requestId !== undefined && parentRequestIds.has(requestId));
}

function firstString(entries: ClaudeCodeRawEntry[], key: string, accepts: (value: string) => boolean): string | undefined {
  for (const entry of entries) {
    const value = entry[key];
    if (typeof value === "string" && accepts(value)) return value;
  }
  return undefined;
}

const labelOf = (meta: SubagentMeta): string => (meta.agentType ? `Agent-${meta.agentType}` : "Agent");

/**
 * Sums one Claude Code subagent transcript. `entries` is what the line reader
 * kept, so a truncated last line is already gone. Rounds in `parentRequestIds`
 * are skipped, and `<synthetic>` rounds are no request, as for the main agent.
 */
export function extractClaudeCodeRunUsage(
  entries: ClaudeCodeRawEntry[],
  meta: SubagentMeta,
  parentRequestIds: ReadonlySet<string>,
): ClaudeCodeRunUsageResult {
  const rounds = groupTurnRequestRounds(entries).filter((round) => !isParentCopy(round, parentRequestIds));
  const sums = sumRoundUsage(rounds);

  const requestIds = new Set<string>();
  for (const round of rounds) {
    requestIds.add(round.messageId);
    const requestId = requestIdOf(round);
    if (requestId !== undefined) requestIds.add(requestId);
  }

  return {
    usage: {
      id: firstString(entries, "agentId", (value) => subagentRunIdSchema.safeParse(value).success),
      label: labelOf(meta),
      model: rounds.length > 0 ? modelOf(rounds[rounds.length - 1]) ?? "unknown" : "unknown",
      roundsCount: rounds.length,
      ...sums,
      costAiCredits: unavailableTokenCount(NO_AI_CREDITS_REASON),
      parentRunId: meta.parentAgentId,
      startedAt: firstString(entries, "timestamp", (value) => ISO_UTC.test(value) && !Number.isNaN(Date.parse(value))),
    },
    requestIds,
  };
}
