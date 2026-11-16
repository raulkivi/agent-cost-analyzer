// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { unavailableTokenCount, type SubagentRunUsage } from "@agent-cost-analyzer/domain";
import { planClaudeCodeAudit } from "./subagent-audit-plan.js";
import {
  BEYOND_READ_DEPTH_AUDIT_REASON,
  missingTranscriptReason,
  TOO_MANY_TRANSCRIPTS_AUDIT_REASON,
} from "./subagent-audit-reasons.js";
import {
  MAX_CLAUDE_CODE_RUN_DEPTH,
  SUBAGENT_NESTING_TOO_DEEP_REASON,
  SUBAGENT_TOO_MANY_REASON,
  SUBAGENT_TRANSCRIPT_MISSING_REASON,
} from "./subagent-attribution.js";
import type { SubagentMeta } from "./subagent-meta.js";

const known = (value: number) => ({ known: true as const, value });

function run(id: string, extra: Partial<SubagentRunUsage> = {}): SubagentRunUsage {
  return {
    id,
    label: "Agent-general-purpose",
    model: "claude-sonnet-5-5",
    roundsCount: 1,
    uncachedInput: known(1),
    cacheWrite: known(0),
    cacheRead: known(0),
    reasoning: known(0),
    output: known(1),
    costAiCredits: unavailableTokenCount("no AI Credits"),
    attribution: "tool-use-id",
    ...extra,
  };
}

const unknownRun = (id: string, reason: string, extra: Partial<SubagentRunUsage> = {}): SubagentRunUsage => {
  const unknown = unavailableTokenCount(reason);
  return run(id, { uncachedInput: unknown, cacheWrite: unknown, cacheRead: unknown, reasoning: unknown, output: unknown, ...extra });
};

const attributionOf = (...turns: [number, SubagentRunUsage[]][]) => ({
  byTurn: new Map(turns.map(([turn, runs]) => [turn, { runs, notes: [] }])),
});

describe("planClaudeCodeAudit", () => {
  it("reads a run whose transcript was read and starts depth at 1", () => {
    const plan = planClaudeCodeAudit(attributionOf([2, [run("a1")]]), new Map<string, SubagentMeta>([["a1", { toolUseId: "toolu_x" }]]));

    expect(plan.unread).toEqual([]);
    expect(plan.reads).toEqual([{ turn: 2, runId: "a1", label: "Agent-general-purpose", depth: 1, startedByCallId: "toolu_x" }]);
  });

  it("marks a run CS8 placed by time, and no other", () => {
    const plan = planClaudeCodeAudit(
      attributionOf([0, [run("a1", { attribution: "timestamp" }), run("b1")]]),
      new Map(),
    );

    expect(plan.reads.map((read) => [read.runId, read.matchedByTime])).toEqual([
      ["a1", true],
      ["b1", undefined],
    ]);
  });

  it("gives a nested run its chain depth and parent, and an outer run no parent", () => {
    const plan = planClaudeCodeAudit(
      attributionOf([0, [run("a1"), run("b1", { parentRunId: "a1" }), run("c1", { parentRunId: "b1" })]]),
      new Map(),
    );

    expect(plan.reads.map((read) => [read.runId, read.depth, read.parentRunId])).toEqual([
      ["a1", 1, undefined],
      ["b1", 2, "a1"],
      ["c1", 3, "b1"],
    ]);
  });

  it("takes the meta's spawnDepth when the parent run is not in the folder", () => {
    const plan = planClaudeCodeAudit(attributionOf([0, [run("b1", { parentRunId: "gone" })]]), new Map([["b1", { spawnDepth: 3 }]]));

    expect(plan.reads[0]).toMatchObject({ runId: "b1", depth: 3, parentRunId: "gone" });
  });

  it("leaves a run nested deeper than the read depth unread, with the audit's own reason", () => {
    const chain = Array.from({ length: MAX_CLAUDE_CODE_RUN_DEPTH + 1 }, (_, index) =>
      run(`r${index}`, index === 0 ? {} : { parentRunId: `r${index - 1}` }),
    );

    const plan = planClaudeCodeAudit(attributionOf([0, chain]), new Map());

    expect(plan.reads).toHaveLength(MAX_CLAUDE_CODE_RUN_DEPTH);
    expect(plan.unread).toHaveLength(1);
    expect(plan.unread[0]).toMatchObject({ runId: `r${MAX_CLAUDE_CODE_RUN_DEPTH}`, depth: MAX_CLAUDE_CODE_RUN_DEPTH, reason: BEYOND_READ_DEPTH_AUDIT_REASON });
  });

  it("leaves a parentAgentId cycle unread, never looping", () => {
    const plan = planClaudeCodeAudit(attributionOf([0, [run("a", { parentRunId: "b" }), run("b", { parentRunId: "a" })]]), new Map());

    expect(plan.reads).toEqual([]);
    expect(plan.unread.map((unread) => unread.reason)).toEqual([BEYOND_READ_DEPTH_AUDIT_REASON, BEYOND_READ_DEPTH_AUDIT_REASON]);
  });

  it("words each unread cause about tool calls, not tokens", () => {
    const plan = planClaudeCodeAudit(
      attributionOf([
        1,
        [
          unknownRun("a1", SUBAGENT_TRANSCRIPT_MISSING_REASON),
          unknownRun("a2", SUBAGENT_TOO_MANY_REASON),
          unknownRun("a3", SUBAGENT_NESTING_TOO_DEEP_REASON),
        ],
      ]),
      new Map(),
    );

    expect(plan.unread.map((unread) => unread.reason)).toEqual([
      missingTranscriptReason("Agent-general-purpose"),
      TOO_MANY_TRANSCRIPTS_AUDIT_REASON,
      BEYOND_READ_DEPTH_AUDIT_REASON,
    ]);
    expect(plan.unread.every((unread) => unread.turn === 1)).toBe(true);
  });

  it("reads a run whose tokens are unknown for another reason (a round missing a usage field)", () => {
    const plan = planClaudeCodeAudit(
      attributionOf([0, [run("a1", { output: unavailableTokenCount("A round in this run has no output_tokens.") })]]),
      new Map(),
    );

    expect(plan.reads.map((read) => read.runId)).toEqual(["a1"]);
    expect(plan.unread).toEqual([]);
  });

  it("drops a started-by id that is not a valid call id", () => {
    const plan = planClaudeCodeAudit(attributionOf([0, [run("a1")]]), new Map([["a1", { toolUseId: "has space" }]]));

    expect(plan.reads[0]).not.toHaveProperty("startedByCallId");
  });
});
