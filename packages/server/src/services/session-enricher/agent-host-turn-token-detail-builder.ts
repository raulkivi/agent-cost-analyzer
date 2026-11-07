// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TokenCount } from "@agent-cost-analyzer/domain";
import { unavailableTokenCount } from "@agent-cost-analyzer/domain";
import type { AgentHostTurnTokens } from "../../data-sources/agent-host/agent-session-store.js";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import { readCopilotCallUsage, type CopilotCallUsage } from "./agent-host-call-usage.js";

// Cache-write and reasoning tokens for an Agent Host turn, from the Copilot
// CLI's session.usage_record events (vscode-extension.md step 10.15). Pure.
// All-or-nothing per turn: the records are used only when their sums equal
// session.db's totals, which proves they cover every call it counted.

export interface AgentHostTurnTokenDetail {
  cacheWrite: TokenCount;
  reasoning: TokenCount;
}

export const AGENT_HOST_USAGE_RECORDS_NO_TOTALS_REASON =
  "VS Code's session database has no token totals for this turn to check the Copilot CLI event log's per-call usage records against.";
export const AGENT_HOST_USAGE_RECORDS_MISSING_REASON =
  "This turn's Copilot CLI event log has no per-call usage records (Copilot CLI 1.0.95 and later write them).";
export const AGENT_HOST_USAGE_RECORDS_INCOMPLETE_REASON =
  "The Copilot CLI event log's per-call usage records don't cover the whole turn, so they can't be trusted for it.";
export const AGENT_HOST_CACHE_WRITE_NOT_REPORTED_REASON =
  "The Copilot CLI didn't report cache-write tokens for at least one call in this turn.";
export const AGENT_HOST_REASONING_NOT_REPORTED_REASON =
  "The Copilot CLI didn't report reasoning tokens for at least one call in this turn.";

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// Known only when every record has the figure.
function sumIfAll(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === values.length ? sum(present) : null;
}

function unknown(reason: string): AgentHostTurnTokenDetail {
  return { cacheWrite: unavailableTokenCount(reason), reasoning: unavailableTokenCount(reason) };
}

function field(value: number | null, reason: string): TokenCount {
  return value === null ? unavailableTokenCount(reason) : { known: true, value };
}

export function buildAgentHostTurnTokenDetail(turnEvents: CopilotEvent[], totals: AgentHostTurnTokens | null): AgentHostTurnTokenDetail {
  if (totals === null) return unknown(AGENT_HOST_USAGE_RECORDS_NO_TOTALS_REASON);

  const records = turnEvents.map(readCopilotCallUsage).filter((record): record is CopilotCallUsage => record !== null);
  if (records.length === 0) return unknown(AGENT_HOST_USAGE_RECORDS_MISSING_REASON);

  const covers =
    sum(records.map((r) => r.inputTokens)) === totals.input &&
    sum(records.map((r) => r.cacheReadTokens)) === totals.cached &&
    sum(records.map((r) => r.outputTokens)) === totals.output;
  if (!covers) return unknown(AGENT_HOST_USAGE_RECORDS_INCOMPLETE_REASON);

  const cacheWrite = sumIfAll(records.map((r) => r.cacheWriteTokens));
  const reasoning = sumIfAll(records.map((r) => r.reasoningTokens));
  const cacheWriteFits = cacheWrite === null || cacheWrite <= totals.input - totals.cached;
  return {
    cacheWrite: cacheWriteFits
      ? field(cacheWrite, AGENT_HOST_CACHE_WRITE_NOT_REPORTED_REASON)
      : unavailableTokenCount(AGENT_HOST_USAGE_RECORDS_INCOMPLETE_REASON),
    reasoning: field(reasoning, AGENT_HOST_REASONING_NOT_REPORTED_REASON),
  };
}
