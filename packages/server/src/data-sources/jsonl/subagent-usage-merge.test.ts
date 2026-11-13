// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  turnUsageSchema,
  unavailableTokenCount,
  type SubagentRunUsage,
  type TokenCount,
  type TurnUsage,
} from "@agent-cost-analyzer/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AGENT_TRACES_UNAVAILABLE_REASON, AI_CREDITS_NOT_AVAILABLE_REASON, USAGE_CATEGORY_NOT_EXPOSED_REASON } from "./session-usage-spans.js";
import { SUBAGENT_LOG_MISSING_REASON } from "./subagent-attribution.js";
import { NESTED_SUBAGENTS_REASON } from "./subagent-run-usage.js";
import { mergeSubagentUsage } from "./subagent-usage-merge.js";

const known = (value: number): TokenCount => ({ known: true, value });
const notExposed = unavailableTokenCount(USAGE_CATEGORY_NOT_EXPOSED_REASON);

// A classic turn as extractTurnUsages builds it: cacheWrite/reasoning known
// only with the agent-traces join.
function turn(overrides: Partial<TurnUsage> = {}): TurnUsage {
  return {
    uncachedInput: known(1000),
    cacheWrite: known(200),
    cacheRead: known(5000),
    tool: notExposed,
    vision: notExposed,
    reasoning: known(30),
    output: known(400),
    costAiCredits: known(1.5),
    model: "claude-sonnet-5",
    roundsCount: 3,
    ...overrides,
  };
}

function run(overrides: Partial<SubagentRunUsage> = {}): SubagentRunUsage {
  return {
    id: "toolu_run1",
    label: "runSubagent-Explore",
    model: "claude-haiku-4.5",
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

const none = new Map<number, string>();

describe("mergeSubagentUsage", () => {
  it("leaves a turn with no run as it was: no subagents, no ownUsage", () => {
    const own = turn();

    const [merged] = mergeSubagentUsage([own], new Map(), none);

    expect(merged).toEqual(own);
    expect(merged).not.toHaveProperty("subagents");
    expect(merged).not.toHaveProperty("ownUsage");
  });

  it("adds each run's uncachedInput, cacheRead, output and AI Credits to the turn's", () => {
    const [merged] = mergeSubagentUsage(
      [turn()],
      new Map([[0, [run(), run({ id: "toolu_run2", costAiCredits: known(0.5), output: known(40) })]]]),
      none,
    );

    expect(merged).toMatchObject({
      uncachedInput: known(1200),
      cacheRead: known(6800),
      output: known(500),
      costAiCredits: known(2.25),
    });
  });

  it("adds cacheWrite and reasoning when the turn's and every run's figure is known (agent-traces join)", () => {
    const [merged] = mergeSubagentUsage([turn()], new Map([[0, [run(), run({ id: "toolu_run2" })]]]), none);

    expect(merged?.cacheWrite).toEqual(known(240));
    expect(merged?.reasoning).toEqual(known(40));
  });

  it("makes cacheWrite and reasoning unknown when a run's are, keeping the run's reason", () => {
    const traced = run();
    const untraced = run({
      id: "toolu_run2",
      cacheWrite: unavailableTokenCount(AGENT_TRACES_UNAVAILABLE_REASON),
      reasoning: unavailableTokenCount(AGENT_TRACES_UNAVAILABLE_REASON),
    });

    const [merged] = mergeSubagentUsage([turn()], new Map([[0, [traced, untraced]]]), none);

    expect(merged?.cacheWrite).toEqual(unavailableTokenCount(AGENT_TRACES_UNAVAILABLE_REASON));
    expect(merged?.reasoning).toEqual(unavailableTokenCount(AGENT_TRACES_UNAVAILABLE_REASON));
    expect(merged?.costAiCredits).toEqual(known(2));
  });

  it("makes cacheWrite and reasoning unknown when the turn's own are, even if every run's is known", () => {
    const own = turn({
      cacheWrite: unavailableTokenCount(AGENT_TRACES_UNAVAILABLE_REASON),
      reasoning: unavailableTokenCount(AGENT_TRACES_UNAVAILABLE_REASON),
    });

    const [merged] = mergeSubagentUsage([own], new Map([[0, [run()]]]), none);

    expect(merged?.cacheWrite).toEqual(unavailableTokenCount(AGENT_TRACES_UNAVAILABLE_REASON));
    expect(merged?.reasoning).toEqual(unavailableTokenCount(AGENT_TRACES_UNAVAILABLE_REASON));
  });

  it("makes AI Credits unknown, with the run's reason, when a run's are; its tokens still sum", () => {
    const [merged] = mergeSubagentUsage(
      [turn()],
      new Map([[0, [run({ costAiCredits: unavailableTokenCount(AI_CREDITS_NOT_AVAILABLE_REASON) })]]]),
      none,
    );

    expect(merged?.costAiCredits).toEqual(unavailableTokenCount(AI_CREDITS_NOT_AVAILABLE_REASON));
    expect(merged?.uncachedInput).toEqual(known(1100));
    expect(merged?.output).toEqual(known(460));
  });

  it("makes every summed figure unknown when a run's are (nested run)", () => {
    const nested = unavailableTokenCount(NESTED_SUBAGENTS_REASON);
    const [merged] = mergeSubagentUsage(
      [turn()],
      new Map([[0, [run({ uncachedInput: nested, cacheRead: nested, output: nested, costAiCredits: nested })]]]),
      none,
    );

    expect(merged).toMatchObject({ uncachedInput: nested, cacheRead: nested, output: nested, costAiCredits: nested });
  });

  it("keeps the turn's own unknown AI Credits reason when a run is known", () => {
    const own = turn({ costAiCredits: unavailableTokenCount(AI_CREDITS_NOT_AVAILABLE_REASON) });

    const [merged] = mergeSubagentUsage([own], new Map([[0, [run()]]]), none);

    expect(merged?.costAiCredits).toEqual(unavailableTokenCount(AI_CREDITS_NOT_AVAILABLE_REASON));
  });

  it("leaves tool, vision, model and roundsCount as the main agent's (D1: rounds are the main agent's only)", () => {
    const own = turn();

    const [merged] = mergeSubagentUsage([own], new Map([[0, [run({ model: "gpt-5.6-luna", roundsCount: 9 })]]]), none);

    expect(merged).toMatchObject({ tool: notExposed, vision: notExposed, model: "claude-sonnet-5", roundsCount: 3 });
  });

  it("lists the runs in the order given (ref order, then matched by time)", () => {
    const first = run({ id: "toolu_a" });
    const second = run({ id: "toolu_b", label: "searchSubagent", attribution: "timestamp" });

    const [merged] = mergeSubagentUsage([turn()], new Map([[0, [first, second]]]), none);

    expect(merged?.subagents).toEqual([first, second]);
  });

  it("keeps the main agent's own figures and model in ownUsage (D10)", () => {
    const own = turn();

    const [merged] = mergeSubagentUsage([own], new Map([[0, [run()]]]), none);

    expect(merged?.ownUsage).toEqual({
      uncachedInput: own.uncachedInput,
      cacheWrite: own.cacheWrite,
      cacheRead: own.cacheRead,
      tool: own.tool,
      vision: own.vision,
      reasoning: own.reasoning,
      output: own.output,
      costAiCredits: own.costAiCredits,
      model: own.model,
    });
  });

  it("counts a 0.00 run (searchSubagent) as a known 0, not as unknown (D8)", () => {
    const search = run({ label: "searchSubagent", costAiCredits: known(0), model: "copilot-search-a" });

    const [merged] = mergeSubagentUsage([turn()], new Map([[0, [search]]]), none);

    expect(merged?.costAiCredits).toEqual(known(1.5));
    expect(merged?.subagents).toEqual([search]);
  });

  it("keeps a turn with no usable request of its own null: a run doesn't make it known", () => {
    expect(mergeSubagentUsage([null], new Map([[0, [run()]]]), none)).toEqual([null]);
    expect(mergeSubagentUsage([null], new Map(), new Map([[0, SUBAGENT_LOG_MISSING_REASON]]))).toEqual([null]);
  });

  it("makes every summed figure unknown with the reason when a run of the turn couldn't be read", () => {
    const missing = unavailableTokenCount(SUBAGENT_LOG_MISSING_REASON);
    const own = turn();

    const [merged] = mergeSubagentUsage([own], new Map(), new Map([[0, SUBAGENT_LOG_MISSING_REASON]]));

    expect(merged).toMatchObject({
      uncachedInput: missing,
      cacheWrite: missing,
      cacheRead: missing,
      reasoning: missing,
      output: missing,
      costAiCredits: missing,
      tool: notExposed,
      vision: notExposed,
      model: own.model,
      roundsCount: own.roundsCount,
      subagents: [],
    });
    expect(merged?.ownUsage?.costAiCredits).toEqual(own.costAiCredits);
  });

  it("names the unread run's reason ahead of a read run's or the turn's own", () => {
    const own = turn({ costAiCredits: unavailableTokenCount(AI_CREDITS_NOT_AVAILABLE_REASON) });

    const [merged] = mergeSubagentUsage(
      [own],
      new Map([[0, [run({ costAiCredits: unavailableTokenCount(NESTED_SUBAGENTS_REASON) })]]]),
      new Map([[0, SUBAGENT_LOG_MISSING_REASON]]),
    );

    expect(merged?.costAiCredits).toEqual(unavailableTokenCount(SUBAGENT_LOG_MISSING_REASON));
    expect(merged?.subagents).toHaveLength(1);
  });

  it("merges each log turn with its own runs only", () => {
    const merged = mergeSubagentUsage(
      [turn(), turn({ costAiCredits: known(2) }), turn()],
      new Map([[1, [run()]]]),
      new Map([[2, SUBAGENT_LOG_MISSING_REASON]]),
    );

    expect(merged[0]).not.toHaveProperty("subagents");
    expect(merged[1]?.costAiCredits).toEqual(known(2.25));
    expect(merged[2]?.costAiCredits).toEqual(unavailableTokenCount(SUBAGENT_LOG_MISSING_REASON));
  });

  it("does not change its inputs", () => {
    const own = turn();
    const runs = [run()];
    const snapshot = structuredClone({ own, runs });

    mergeSubagentUsage([own], new Map([[0, runs]]), none);

    expect({ own, runs }).toEqual(snapshot);
  });

  it("returns schema-valid usages (subagents and ownUsage together)", () => {
    const merged = mergeSubagentUsage(
      [turn(), turn(), null],
      new Map([[1, [run()]]]),
      new Map([[0, SUBAGENT_LOG_MISSING_REASON]]),
    );

    for (const usage of merged) {
      if (usage !== null) {
        expect(() => turnUsageSchema.parse(usage)).not.toThrow();
      }
    }
  });
});

describe("mergeSubagentUsage properties", () => {
  const figure: fc.Arbitrary<TokenCount> = fc.oneof(
    { weight: 4, arbitrary: fc.double({ min: 0, max: 1e6, noNaN: true }).map(known) },
    { weight: 1, arbitrary: fc.constantFrom("a reason", "another reason").map(unavailableTokenCount) },
  );
  const summedFields = ["uncachedInput", "cacheWrite", "cacheRead", "reasoning", "output", "costAiCredits"] as const;
  const figures = fc.record({
    uncachedInput: figure,
    cacheWrite: figure,
    cacheRead: figure,
    reasoning: figure,
    output: figure,
    costAiCredits: figure,
  });

  it("gives a known total exactly own + Σ runs, and an unknown one (never 0) when any part is unknown", () => {
    fc.assert(
      fc.property(figures, fc.array(figures, { minLength: 1, maxLength: 4 }), fc.boolean(), (ownFigures, runFigures, unread) => {
        const own = turn(ownFigures);
        const runs = runFigures.map((figs, index) => run({ id: `toolu_${index}`, ...figs }));

        const [merged] = mergeSubagentUsage([own], new Map([[0, runs]]), unread ? new Map([[0, "unread"]]) : none);

        for (const field of summedFields) {
          const parts = [own[field], ...runs.map((r) => r[field])];
          const total = merged![field];
          if (unread || parts.some((part) => !part.known)) {
            expect(total.known).toBe(false);
            expect(total).not.toHaveProperty("value");
          } else {
            const expected = parts.reduce((sum, part) => sum + (part.known ? part.value : Number.NaN), 0);
            expect(total).toEqual(known(expected));
          }
        }
      }),
    );
  });
});
