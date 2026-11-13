// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SubagentRunUsage, Turn } from "@agent-cost-analyzer/domain";
import { makeTurn } from "./turn-fixture.js";

const known = (value: number) => ({ known: true as const, value });

export function makeRun(overrides: Partial<SubagentRunUsage> = {}): SubagentRunUsage {
  return {
    id: "call_1",
    label: "runSubagent-Explore",
    agentName: "Explore",
    model: "claude-haiku-4.5",
    roundsCount: 14,
    uncachedInput: known(10),
    cacheWrite: known(0),
    cacheRead: known(5),
    reasoning: known(0),
    output: known(20),
    costAiCredits: known(30.11),
    attribution: "child-session-ref",
    ...overrides,
  };
}

// A turn whose total folds its own credits and its runs'. `total` unknown
// models an unread run (the reason is the reader's).
export function makeTurnWithRuns(
  runs: SubagentRunUsage[],
  options: { own?: number; unreadReason?: string; index?: number } = {},
): Turn {
  const own = options.own ?? 4.25;
  const base = makeTurn({ index: options.index ?? 3 }).usage;
  const unknownRun = runs.find((run) => !run.costAiCredits.known);
  const unreadReason = options.unreadReason ?? (unknownRun?.costAiCredits.known === false ? unknownRun.costAiCredits.reason : undefined);
  const total = unreadReason
    ? { known: false as const, reason: unreadReason }
    : known(own + runs.reduce((sum, run) => sum + (run.costAiCredits.known ? run.costAiCredits.value : 0), 0));
  return makeTurn({
    index: options.index ?? 3,
    usage: {
      ...base,
      costAiCredits: total,
      subagents: runs,
      ownUsage: {
        uncachedInput: base.uncachedInput,
        cacheWrite: base.cacheWrite,
        cacheRead: base.cacheRead,
        tool: base.tool,
        vision: base.vision,
        reasoning: base.reasoning,
        output: base.output,
        costAiCredits: known(own),
        model: base.model,
      },
    },
  });
}
