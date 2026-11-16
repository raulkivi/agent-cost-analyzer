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

// Step CS13: a Claude Code turn as get_turn sends it: tokens and a priced
// cost on the turn, the main agent's own line and each run; no AI Credits.
type Cost = NonNullable<TurnView["usage"]["pricedCost"]>;
type Count = TurnView["usage"]["uncachedInput"];
const NO_CREDITS = { known: false as const, reason: "AI Credits are GitHub Copilot's own billing unit — a Claude Code CLI session has no AI Credits conversion." };
export const priced = (amount: number): Cost => ({ known: true, amount, currency: "USD", basis: "priced", priceVersionIds: ["anthropic-api:claude-sonnet-5.5:2026-10-01"] });
export const unpriced = (reason: string): Cost => ({ known: false, reason });
const count = (value: number): Count => ({ known: true, value });

// Four token fields that add up to `total`.
function fieldsOf(total: number) {
  const cacheRead = Math.round(total * 0.7);
  const each = Math.round(total * 0.1);
  return { uncachedInput: count(each), cacheWrite: count(each), cacheRead: count(cacheRead), output: count(total - cacheRead - 2 * each) };
}

export function claudeRun(overrides: Partial<Run> & { total?: number; cost?: Cost } = {}): Run {
  const { total = 1_310_000, cost = priced(0.09), ...rest } = overrides;
  return { id: "agent-a", label: "Agent-Explore", model: "claude-haiku-4.5", roundsCount: 9, ...fieldsOf(total), reasoning: count(0), costAiCredits: NO_CREDITS, attribution: "tool-use-id", pricedCost: cost, ...rest };
}

export function missingClaudeRun(): Run {
  const gone: Count = { known: false, reason: "The subagent transcript this turn started is missing." };
  return claudeRun({ id: "agent-m", label: "Agent-Plan", model: "unknown", roundsCount: 0, uncachedInput: gone, cacheWrite: gone, cacheRead: gone, output: gone, reasoning: gone, cost: unpriced("Cannot price: The log records no model for this turn.") });
}

export function claudeTurnView(runs: Run[], options: { ownTotal?: number; ownCost?: Cost } = {}): TurnView {
  const { ownTotal = 500_000, ownCost = priced(0.21) } = options;
  const own = fieldsOf(ownTotal);
  const sum = (field: keyof typeof own): Count => {
    const parts = [own[field], ...runs.map((run) => run[field])];
    const unknownPart = parts.find((part) => !part.known);
    return unknownPart ?? count(parts.reduce((total, part) => total + (part as { value: number }).value, 0));
  };
  const costs = [ownCost, ...runs.map((run) => run.pricedCost!)];
  const unknownCost = costs.find((cost) => !cost.known);
  const turnCost = unknownCost ?? priced(costs.reduce((total, cost) => total + (cost as { amount: number }).amount, 0));
  const base = turnView();
  const usage = { ...base.usage, uncachedInput: sum("uncachedInput"), cacheWrite: sum("cacheWrite"), cacheRead: sum("cacheRead"), output: sum("output"), costAiCredits: NO_CREDITS, pricedCost: turnCost, subagents: runs };
  return { ...base, usage: { ...usage, ownUsage: { ...base.usage, ...own, costAiCredits: NO_CREDITS, pricedCost: ownCost } } } as TurnView;
}
