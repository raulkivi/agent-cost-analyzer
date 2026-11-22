// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
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
import type { Attribution } from "../cost-attribution/session-attributor.js";
import type { TurnPricer } from "../pricing/turn-cost-figures.js";
import { foldRuns, mainUsage, subagentRun } from "../../test-support/subagent-usage-fakes.js";

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

  it("reports unknown, not 0, tool calls per turn for an Agent Host session", () => {
    const cost = buildSessionCost(session([turn(0)], { copilotHarness: "agent-host" }));

    expect(cost.topTurns[0]?.toolCalls).toBeNull();
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
    expect(cost.byModel).toMatchObject([
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

  describe("activity (docs/plans/mcp-apps.md §4.7)", () => {
    const now = new Date("2026-09-27T09:00:00.000Z");

    it("flags the session active when its latest turn started within the window of the given clock", () => {
      const cost = buildSessionCost(
        session([turn(0, { startedAt: "2026-09-27T08:00:00.000Z" }), turn(1, { startedAt: "2026-09-27T08:50:00.000Z" })]),
        {},
        { now },
      );

      expect(sessionCostSchema.parse(cost)).toEqual(cost);
      expect(cost).toMatchObject({ lastTurnAt: "2026-09-27T08:50:00.000Z", active: true });
    });

    it("gives only the latest turn start for a session idle longer than the window", () => {
      const cost = buildSessionCost(session([turn(0, { startedAt: "2026-09-27T08:00:00.000Z" })]), {}, { now });

      expect(cost.lastTurnAt).toBe("2026-09-27T08:00:00.000Z");
      expect(cost).not.toHaveProperty("active");
    });

    it("never guesses activity from the session start when turns have no start time", () => {
      const cost = buildSessionCost(session([turn(0)], { startedAt: "2026-09-27T08:59:00.000Z" }), {}, { now });

      expect(cost).not.toHaveProperty("lastTurnAt");
      expect(cost).not.toHaveProperty("active");
    });

    it("leaves activity out without a clock", () => {
      const cost = buildSessionCost(session([turn(0, { startedAt: "2026-09-27T08:59:00.000Z" })]));

      expect(cost).not.toHaveProperty("lastTurnAt");
      expect(cost).not.toHaveProperty("active");
    });
  });

  describe("cost basis and attribution (step 15.6)", () => {
    const portal: Attribution = {
      repository: { attributed: true, repository: { key: "github.com/acme/portal", source: "git-remote" } },
      projectId: "portal",
      vendor: { known: true, vendorId: "anthropic", basis: "profile" },
      channel: { known: true, channel: "anthropic-api" },
    };
    const attributor = { session: () => portal, turn: () => portal };
    const pricer: TurnPricer = {
      figuresFor: (providerId, _session, t) => ({
        billed: { known: false, reason: "no billed figure" },
        reported: { known: false, reason: "no reported figure" },
        priced:
          t.index === 1
            ? { known: false, reason: "no price" }
            : { known: true, amount: 0.5, currency: "USD", basis: "priced", priceVersionIds: [`${providerId}:v`] },
      }),
    };

    it("adds the session's repository and project, per-basis totals with coverage, and price versions", () => {
      const cost = buildSessionCost(session([turn(0), turn(1)]), {}, { providerId: "claude-code", attributor, pricer });
      expect(sessionCostSchema.parse(cost)).toEqual(cost);
      expect(cost).toMatchObject({ repositoryKey: "github.com/acme/portal", projectId: "portal" });
      expect(cost.cost.priced).toMatchObject({ turns: 2, knownTurns: 1, usd: 0.5 });
      expect(cost.cost.priceVersionIds).toEqual(["claude-code:v"]);
      expect(cost.topTurns.find((t) => t.turnIndex === 1)?.cost.priced).toEqual({ known: false, reason: "no price" });
    });

    it("keeps the existing AI Credits figures unchanged", () => {
      const plain = buildSessionCost(session([turn(0)]));
      const priced = buildSessionCost(session([turn(0)]), {}, { providerId: "claude-code", attributor, pricer });
      expect(priced.totals).toEqual(plain.totals);
    });

    // Chat views: a provider without AI Credits shows a priced cost tile and AI Credits n/a.
    it("flags a Claude Code session as without AI Credits and gives the first unknown priced reason", () => {
      const cost = buildSessionCost(session([turn(0), turn(1)]), {}, { providerId: "claude-code", attributor, pricer });
      expect(sessionCostSchema.parse(cost)).toEqual(cost);
      expect(cost.withoutAiCredits).toBe(true);
      expect(cost.pricedCostUnknownReason).toBe("no price");
    });

    it("gives no unknown reason when every turn is priced", () => {
      const cost = buildSessionCost(session([turn(0)]), {}, { providerId: "claude-code", attributor, pricer });
      expect(cost.withoutAiCredits).toBe(true);
      expect(cost).not.toHaveProperty("pricedCostUnknownReason");
    });

    it("leaves the flag out for a Copilot session", () => {
      const cost = buildSessionCost(session([turn(0), turn(1)], { providerId: "vscode" }), {}, { providerId: "vscode", attributor, pricer });
      expect(cost).not.toHaveProperty("withoutAiCredits");
      expect(cost).not.toHaveProperty("pricedCostUnknownReason");
    });

    it("leaves repository and project out when attribution isn't configured", () => {
      const cost = buildSessionCost(session([turn(0)]));
      expect(cost).not.toHaveProperty("repositoryKey");
      expect(cost.cost.priced.knownTurns).toBe(0);
    });
  });

  describe("subagent runs (step 10.19)", () => {
    it("summarises the runs and their AI Credits from the session's subagent spend", () => {
      const withSpend = session([turn(0)], { subagentSpend: { runs: 3, costAiCredits: k(54.65) } });
      const cost = buildSessionCost(withSpend);
      expect(sessionCostSchema.parse(cost)).toEqual(cost);
      expect(cost.subagents).toEqual({ runs: 3, aiCredits: 54.65 });
    });

    it("keeps unknown AI Credits null with the reason, never 0 (constraint 6)", () => {
      const reason = "The log of a subagent run is missing.";
      const cost = buildSessionCost(session([turn(0)], { subagentSpend: { runs: 1, costAiCredits: unavailableTokenCount(reason) } }));
      expect(cost.subagents).toEqual({ runs: 1, aiCredits: null, unavailableReason: reason });
    });

    it("leaves the summary out when no run was read", () => {
      expect(buildSessionCost(session([turn(0)]))).not.toHaveProperty("subagents");
    });

    // Step CS11 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/claude-code-subagents.md D13): a provider without AI Credits
    // shows the runs' tokens and priced cost beside the unknown AI Credits.
    describe("Claude Code runs (step CS11, D13)", () => {
      const portal: Attribution = {
        repository: { attributed: true, repository: { key: "github.com/acme/portal", source: "git-remote" } },
        projectId: "portal",
        vendor: { known: true, vendorId: "anthropic", basis: "profile" },
        channel: { known: true, channel: "anthropic-api" },
      };
      const attributor = { session: () => portal, turn: () => portal };
      // One cent per output token, so a line's price shows which line it is.
      const pricer: TurnPricer = {
        figuresFor: (_providerId, _session, t) => ({
          billed: { known: false, reason: "no billed figure" },
          reported: { known: false, reason: "no reported figure" },
          priced: t.usage.output.known
            ? { known: true, amount: t.usage.output.value / 100, currency: "USD", basis: "priced" }
            : { known: false, reason: "no price" },
        }),
      };
      const noCredits = unavailableTokenCount(NO_CREDITS);
      const run = (id: string) =>
        subagentRun({ id, label: "Agent-Explore", model: "model-b", costAiCredits: noCredits, attribution: "tool-use-id" });
      const own = mainUsage({ model: "model-a", costAiCredits: noCredits, output: k(400) });
      const tokens = { uncachedInput: k(200), cacheWrite: k(40), cacheRead: k(1800), output: k(120) };
      const spendOf = (overrides = {}) => ({ runs: 2, costAiCredits: noCredits, tokens, ...overrides });
      const twoRuns = () => [turn(0, { usage: foldRuns(own, [run("r1"), run("r2")]) })];

      it("adds the runs' tokens and priced cost, with AI Credits unknown and its reason", () => {
        const cost = buildSessionCost(session(twoRuns(), { subagentSpend: spendOf() }), {}, { providerId: "claude-code", attributor, pricer });

        expect(sessionCostSchema.parse(cost)).toEqual(cost);
        expect(cost.subagents).toMatchObject({
          runs: 2,
          aiCredits: null,
          unavailableReason: NO_CREDITS,
          tokens: { uncachedInput: 200, cacheWrite: 40, cacheRead: 1800, output: 120 },
        });
        // Two runs of 60 output tokens each: 0.6 + 0.6 USD, the main agent's 4 USD left out.
        expect(cost.subagents?.cost?.priced).toMatchObject({ known: true, amount: 1.2, currency: "USD" });
      });

      it("keeps the priced cost unknown, with a reason, when no pricer is configured", () => {
        const cost = buildSessionCost(session(twoRuns(), { subagentSpend: spendOf() }));

        expect(cost.subagents?.tokens?.output).toBe(120);
        expect(cost.subagents?.cost?.priced.known).toBe(false);
      });

      it("keeps an unknown token sum null, and the cost unknown, never 0 (constraint 6)", () => {
        const reason = "A subagent transcript in this session's folder could not be matched to a turn.";
        const unknown = unavailableTokenCount(reason);
        const unknownTokens = { uncachedInput: unknown, cacheWrite: unknown, cacheRead: unknown, output: unknown };
        const cost = buildSessionCost(
          session(twoRuns(), { subagentSpend: spendOf({ tokens: unknownTokens }) }),
          {},
          { providerId: "claude-code", attributor, pricer },
        );

        expect(cost.subagents?.tokens).toEqual({ uncachedInput: null, cacheWrite: null, cacheRead: null, output: null });
        expect(cost.subagents?.cost?.priced).toMatchObject({ known: false });
        expect(sessionCostSchema.parse(cost)).toEqual(cost);
      });

      it("leaves a Copilot session's summary as it was, without tokens or cost", () => {
        const copilot = session([turn(0, { usage: mainUsage() })], { providerId: "vscode", subagentSpend: { runs: 3, costAiCredits: k(54.65) } });
        const cost = buildSessionCost(copilot, {}, { providerId: "vscode", attributor, pricer });

        expect(cost.subagents).toEqual({ runs: 3, aiCredits: 54.65 });
      });
    });
  });
});

// Step 10.19 (classic subagents plan §4.5): byModel groups a turn's cost
// lines, so each subagent run's model gets its own share; turns stay one
// row each.
describe("buildSessionCost with subagent runs", () => {
  it("credits each run's model in byModel, counting a turn once per model it used", () => {
    const cost = buildSessionCost(
      session(
        [
          turn(0, { usage: foldRuns(mainUsage({ model: "model-a", costAiCredits: k(1.5) }), [subagentRun({ model: "model-b", costAiCredits: k(0.25) }), subagentRun({ id: "r2", model: "model-a", costAiCredits: k(0.5) })]) }),
          turn(1, { usage: mainUsage({ model: "model-a", costAiCredits: k(1) }) }),
        ],
        { providerId: "vscode" },
      ),
    );
    expect(cost.turnCount).toBe(2);
    expect(cost.totals.aiCredits).toMatchObject({ value: 3.25, turns: 2 });
    expect(cost.byModel.map((entry) => [entry.model, entry.turns, entry.aiCredits])).toEqual([
      ["model-a", 2, 3],
      ["model-b", 1, 0.25],
    ]);
    expect(sessionCostSchema.parse(cost)).toEqual(cost);
  });
});
