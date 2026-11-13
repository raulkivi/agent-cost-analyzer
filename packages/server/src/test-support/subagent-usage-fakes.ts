// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { unavailableTokenCount, type SubagentRunUsage, type TokenCount, type TurnUsage } from "@agent-cost-analyzer/domain";
import { mergeSubagentUsage } from "../data-sources/jsonl/subagent-usage-merge.js";

// Step 10.19: classic Copilot turns with subagent runs, folded by the
// reader's own merge (SA8), for the cost-line tests.

export const known = (value: number): TokenCount => ({ known: true, value });
const notExposed = unavailableTokenCount("not exposed");

export function mainUsage(overrides: Partial<TurnUsage> = {}): TurnUsage {
  return {
    uncachedInput: known(1000),
    cacheWrite: known(200),
    cacheRead: known(5000),
    tool: notExposed,
    vision: notExposed,
    reasoning: known(30),
    output: known(400),
    costAiCredits: known(1.5),
    model: "claude-sonnet-5.5",
    roundsCount: 3,
    ...overrides,
  };
}

export function subagentRun(overrides: Partial<SubagentRunUsage> = {}): SubagentRunUsage {
  return {
    id: "toolu_run1",
    label: "runSubagent-Explore",
    model: "gpt-6.1-sol",
    roundsCount: 7,
    uncachedInput: known(100),
    cacheWrite: known(20),
    cacheRead: known(900),
    reasoning: known(5),
    output: known(60),
    costAiCredits: known(0.25),
    attribution: "child-session-ref",
    ...overrides,
  };
}

// The usage the reader gives a turn with these runs and, optionally, a run it could not read.
export function foldRuns(usage: TurnUsage, runs: readonly SubagentRunUsage[], unreadReason?: string): TurnUsage {
  const unread = unreadReason === undefined ? new Map<number, string>() : new Map([[0, unreadReason]]);
  return mergeSubagentUsage([usage], new Map([[0, runs]]), unread)[0]!;
}
