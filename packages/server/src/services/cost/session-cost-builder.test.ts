import { describe, expect, it } from "vitest";
import {
  sessionCostSchema,
  unavailableTokenCount,
  type Session,
  type TokenCount,
  type Turn,
  type TurnUsage,
} from "@agent-cost-analyzer/domain";
import { buildSessionCost } from "./session-cost-builder.js";

const k = (value: number, estimated?: boolean): TokenCount => ({ known: true, value, ...(estimated ? { estimated } : {}) });
const NO_CREDITS = "This log format records no AI Credits.";

function usage(overrides: Partial<TurnUsage> = {}): TurnUsage {
  return {
    uncachedInput: k(10),
    cacheWrite: k(0),
    cacheRead: k(90),
    tool: unavailableTokenCount("n/a"),
    vision: unavailableTokenCount("n/a"),
    reasoning: unavailableTokenCount("n/a"),
    output: k(5),
    costAiCredits: unavailableTokenCount(NO_CREDITS),
    model: "model-a",
    ...overrides,
  };
}

function turn(index: number, overrides: Partial<Turn> = {}): Turn {
  return {
    index,
    userMessage: `prompt ${index}`,
    assistantResponse: "",
    toolCalls: [],
    usage: usage(),
    explanation: "",
    ...overrides,
  };
}

function session(turns: Turn[], overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    mode: "analyze",
    providerId: "claude-code",
    title: "Refactor",
    model: "model-a",
    turns,
    turnCount: turns.length,
    costAiCredits: unavailableTokenCount(NO_CREDITS),
    usageDataAvailable: true,
    startedAt: "2026-09-27T08:00:00.000Z",
    ...overrides,
  };
}

describe("buildSessionCost", () => {
  it("sums known turns, reports coverage, and keeps unknown AI Credits null rather than 0", () => {
    const cost = buildSessionCost(session([turn(0), turn(1)]));

    expect(sessionCostSchema.parse(cost)).toEqual(cost);
    expect(cost.totals.output).toEqual({ value: 10, knownTurns: 2, turns: 2, estimated: false });
    expect(cost.totals.inputTokens.value).toBe(200);
    expect(cost.totals.aiCredits).toEqual({ value: null, knownTurns: 0, turns: 2, estimated: false });
    expect(cost.unavailableReasons).toContain(NO_CREDITS);
  });

  it("reports partial coverage when only some turns are known", () => {
    const cost = buildSessionCost(session([turn(0), turn(1, { usage: usage({ output: unavailableTokenCount("lost") }) })]));

    expect(cost.totals.output).toEqual({ value: 5, knownTurns: 1, turns: 2, estimated: false });
  });

  it("flags totals that include a local-tokenizer estimate", () => {
    const cost = buildSessionCost(session([turn(0, { usage: usage({ output: k(7, true) }) })]));

    expect(cost.totals.output.estimated).toBe(true);
  });

  it("computes the cache hit ratio over input tokens", () => {
    const cost = buildSessionCost(session([turn(0), turn(1, { usage: usage({ uncachedInput: k(100), cacheRead: k(0) }) })]));

    expect(cost.cacheHitRatio).toBeCloseTo(90 / 200);
  });

  it("returns a null cache hit ratio when no input is known", () => {
    const cost = buildSessionCost(session([turn(0, { usage: usage({ uncachedInput: unavailableTokenCount("x") }) })]));

    expect(cost.cacheHitRatio).toBeNull();
  });

  it("ranks the top turns by input tokens when AI Credits are unknown, bounded by topTurns", () => {
    const cost = buildSessionCost(
      session([
        turn(0),
        turn(1, { usage: usage({ cacheRead: k(900) }) }),
        turn(2, { usage: usage({ cacheRead: k(400) }) }),
      ]),
      { topTurns: 2 },
    );

    expect(cost.rankedBy).toBe("inputTokens");
    expect(cost.topTurns.map((t) => t.turnIndex)).toEqual([1, 2]);
    expect(cost.topTurns[0]).toMatchObject({ inputTokens: 910, output: 5, aiCredits: null, toolCalls: 0, userMessage: "prompt 1" });
  });

  it("ranks by AI Credits when every turn has them", () => {
    const cost = buildSessionCost(
      session([
        turn(0, { usage: usage({ costAiCredits: k(3), cacheRead: k(900) }) }),
        turn(1, { usage: usage({ costAiCredits: k(5) }) }),
      ]),
    );

    expect(cost.rankedBy).toBe("aiCredits");
    expect(cost.topTurns.map((t) => t.turnIndex)).toEqual([1, 0]);
    expect(cost.totals.aiCredits.value).toBe(8);
  });

  it("redacts and bounds the user message excerpt of a top turn", () => {
    const cost = buildSessionCost(session([turn(0, { userMessage: `token=supersecretvalue ${"x".repeat(500)}` })]));

    const excerpt = cost.topTurns[0].userMessage;
    expect(excerpt).not.toContain("supersecretvalue");
    expect(excerpt.length).toBeLessThanOrEqual(160);
  });

  it("lists cost-relevant events and a per-model breakdown", () => {
    const cost = buildSessionCost(
      session([
        turn(0),
        turn(1, { triggeredEvent: "model-switch", usage: usage({ model: "model-b", output: k(50) }) }),
        turn(2, { triggeredEvent: "compaction", usage: usage({ model: "model-b" }) }),
      ]),
    );

    expect(cost.events).toEqual([
      { turnIndex: 1, event: "model-switch" },
      { turnIndex: 2, event: "compaction" },
    ]);
    expect(cost.byModel).toEqual([
      { model: "model-b", turns: 2, inputTokens: 200, output: 55, aiCredits: null },
      { model: "model-a", turns: 1, inputTokens: 100, output: 5, aiCredits: null },
    ]);
  });

  it("summarises context overhead from the system prompt and tool inventory", () => {
    const cost = buildSessionCost(
      session([turn(0)], {
        systemPrompt: [
          { kind: "built-in", label: "Base", tokenCount: k(1000) },
          { kind: "tool-definitions", label: "Tools", tokenCount: unavailableTokenCount("x") },
        ],
        toolInventory: [
          { name: "Bash", loaded: true, invokedInTurns: [0] },
          { name: "WebFetch", loaded: true, invokedInTurns: [] },
          { name: "Lazy", loaded: false, invokedInTurns: [] },
        ],
      }),
    );

    expect(cost.contextOverhead).toEqual({
      systemPrompt: {
        tokens: 1000,
        components: [
          { kind: "built-in", label: "Base", tokens: 1000 },
          { kind: "tool-definitions", label: "Tools", tokens: null },
        ],
      },
      toolInventory: { defined: 3, loaded: 2, invoked: 1, neverInvokedCount: 2, neverInvoked: ["WebFetch", "Lazy"] },
    });
  });

  it("says why context overhead is unavailable when the provider records neither", () => {
    const cost = buildSessionCost(session([turn(0)]));

    expect(cost.contextOverhead.unavailableReason).toMatch(/system prompt/i);
    expect(cost.contextOverhead.systemPrompt).toBeUndefined();
  });

  it("handles a session with no turns", () => {
    const cost = buildSessionCost(session([]));

    expect(cost.totals.output).toEqual({ value: null, knownTurns: 0, turns: 0, estimated: false });
    expect(cost.topTurns).toEqual([]);
    expect(cost.cacheHitRatio).toBeNull();
  });
});
