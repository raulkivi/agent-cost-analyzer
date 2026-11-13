// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TurnView } from "@agent-cost-analyzer/domain";

// An invented get_turn result for the turn-detail tests.
export function turnView(overrides: Partial<TurnView> = {}): TurnView {
  const known = (value: number, estimated?: boolean) => ({ known: true as const, value, ...(estimated === undefined ? {} : { estimated }) });
  const unknown = { known: false as const, reason: "no data" };
  return {
    sessionId: "7f3a9c2e",
    turnIndex: 17,
    turnCount: 42,
    model: "claude-sonnet-5.5",
    triggeredEvent: "compaction",
    userMessage: "Rewrite the decoder to stream frames instead of buffering the whole payload.",
    userMessageTruncated: false,
    assistantResponse: "Done. The decoder now yields frames.",
    assistantResponseTruncated: false,
    explanation: "Context was compacted before this turn.",
    usage: {
      uncachedInput: known(19_806),
      cacheWrite: known(22_516),
      cacheRead: known(268_090),
      tool: unknown,
      vision: unknown,
      reasoning: unknown,
      output: known(3108, true),
      costAiCredits: known(4.1),
      model: "claude-sonnet-5.5",
    },
    cost: { billed: unknown, reported: unknown, priced: unknown },
    preferredCost: unknown,
    toolCalls: [
      { name: "read_file", kind: "file-read", status: "success" },
      { name: "read_file", kind: "file-read", status: "success" },
      { name: "run_tests", kind: "shell", status: "error" },
    ],
    ...overrides,
  } as TurnView;
}

type Run = NonNullable<TurnView["usage"]["subagents"]>[number];

// An invented subagent run (step 10.19): known figures unless overridden.
export function subagentRun(overrides: Partial<Run> = {}): Run {
  const known = (value: number) => ({ known: true as const, value });
  return {
    id: "call_abc",
    label: "runSubagent-Explore",
    agentName: "Explore",
    model: "claude-haiku-4.5",
    roundsCount: 14,
    uncachedInput: known(1000),
    cacheWrite: known(0),
    cacheRead: known(5000),
    reasoning: known(0),
    output: known(300),
    costAiCredits: known(30.11),
    attribution: "child-session-ref",
    ...overrides,
  };
}

// A turn that folds in the given runs: the total is the main agent's own 4.25 plus the known runs.
export function turnViewWithRuns(runs: Run[], ownCredits: { known: true; value: number } | { known: false; reason: string } = { known: true, value: 4.25 }): TurnView {
  const base = turnView();
  const sum = runs.reduce((total, run) => total + (run.costAiCredits.known ? run.costAiCredits.value : 0), 0);
  const unknownRun = runs.find((run) => !run.costAiCredits.known);
  const total = unknownRun !== undefined || !ownCredits.known ? { known: false as const, reason: "a subagent run's AI Credits are unknown" } : { known: true as const, value: ownCredits.value + sum };
  return { ...base, usage: { ...base.usage, costAiCredits: total, subagents: runs, ownUsage: { ...base.usage, costAiCredits: ownCredits } } } as TurnView;
}
