// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { unavailableTokenCount, type SubagentRunUsage, type TokenCount, type TurnUsage } from "@agent-cost-analyzer/domain";
import { claudeCodeSubagentSpend } from "./session-subagent-spend.js";
import { NO_AI_CREDITS_REASON } from "./subagent-run-usage.js";

const k = (value: number): TokenCount => ({ known: true, value });
const NO_CREDITS = unavailableTokenCount(NO_AI_CREDITS_REASON);

function run(id: string, overrides: Partial<SubagentRunUsage> = {}): SubagentRunUsage {
  return {
    id,
    label: "Agent-Explore",
    model: "claude-haiku-4.5",
    roundsCount: 2,
    uncachedInput: k(10),
    cacheWrite: k(5),
    cacheRead: k(100),
    reasoning: k(0),
    output: k(20),
    costAiCredits: NO_CREDITS,
    attribution: "tool-use-id",
    ...overrides,
  };
}

function turnWith(runs: SubagentRunUsage[] | undefined): TurnUsage {
  const own = {
    uncachedInput: k(1),
    cacheWrite: k(1),
    cacheRead: k(1),
    tool: NO_CREDITS,
    vision: NO_CREDITS,
    reasoning: k(0),
    output: k(1),
    costAiCredits: NO_CREDITS,
    model: "claude-sonnet-5.5",
  };
  return { ...own, ...(runs ? { subagents: runs, ownUsage: own } : {}) };
}

describe("claudeCodeSubagentSpend", () => {
  it("is absent when no run was read and nothing is unknown", () => {
    expect(claudeCodeSubagentSpend([turnWith(undefined)], [])).toBeUndefined();
  });

  it("counts the runs of every turn and sums their tokens, with AI Credits unknown", () => {
    const spend = claudeCodeSubagentSpend([turnWith([run("a"), run("b")]), turnWith(undefined), turnWith([run("c", { output: k(7) })])], []);

    expect(spend).toEqual({
      runs: 3,
      costAiCredits: NO_CREDITS,
      tokens: { uncachedInput: k(30), cacheWrite: k(15), cacheRead: k(300), output: k(47) },
    });
  });

  it("keeps one unknown field unknown, with its reason, and the others known", () => {
    const reason = "The subagent transcript this turn started is missing.";
    const spend = claudeCodeSubagentSpend([turnWith([run("a"), run("b", { output: unavailableTokenCount(reason) })])], []);

    expect(spend?.tokens?.output).toEqual({ known: false, reason });
    expect(spend?.tokens?.cacheRead).toEqual(k(200));
  });

  it("makes every figure unknown with a session-level reason, even with no run counted", () => {
    const reason = "A subagent transcript in this session's folder could not be matched to a turn.";
    const spend = claudeCodeSubagentSpend([turnWith(undefined)], [reason]);

    expect(spend?.runs).toBe(0);
    expect(spend?.tokens).toEqual({
      uncachedInput: { known: false, reason },
      cacheWrite: { known: false, reason },
      cacheRead: { known: false, reason },
      output: { known: false, reason },
    });
  });
});
