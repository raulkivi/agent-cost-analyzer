import { describe, expect, it } from "vitest";
import { sessionSchema } from "@agent-cost-analyzer/domain";
import type { AgentHostSessionRow } from "../../data-sources/agent-host/agent-host-catalog.js";
import type { AgentHostTurnRow, AgentHostTurnUsage } from "../../data-sources/agent-host/agent-session-store.js";
import {
  AGENT_HOST_FIELD_NOT_RECORDED_REASON,
  AGENT_HOST_NO_TURNS_REASON,
  AGENT_HOST_SESSION_COST_UNAVAILABLE_REASON,
  AGENT_HOST_SESSION_DB_MISSING_REASON,
  AGENT_HOST_TURN_COST_UNAVAILABLE_REASON,
  AGENT_HOST_TURN_TEXT_UNAVAILABLE_NOTE,
  AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON,
  buildAgentHostSession,
  buildAgentHostSessionSummary,
  buildAgentHostTurnUsage,
} from "./agent-host-session-builder.js";

const catalogRow: AgentHostSessionRow = {
  id: "3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1",
  sessionUri: "copilotcli:/3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1",
  title: "Refactor billing module",
  startedAtMs: Date.UTC(2026, 9, 1, 12, 0, 0),
  modifiedAtMs: Date.UTC(2026, 9, 1, 13, 0, 0),
};

function usage(overrides: Partial<AgentHostTurnUsage> = {}): AgentHostTurnUsage {
  return {
    tokens: { input: 1000, cached: 800, output: 50 },
    model: "gpt-6-luna",
    nanoAiu: 1_500_000_000,
    ...overrides,
  };
}

function turn(n: number, turnUsage: AgentHostTurnUsage | null = usage()): AgentHostTurnRow {
  return { turnId: `request_${n}`, usage: turnUsage };
}

describe("buildAgentHostTurnUsage", () => {
  it("splits input into uncached and cache-read tokens and converts nano-AIU to AI Credits", () => {
    expect(buildAgentHostTurnUsage(usage())).toMatchObject({
      uncachedInput: { known: true, value: 200 },
      cacheRead: { known: true, value: 800 },
      output: { known: true, value: 50 },
      costAiCredits: { known: true, value: 1.5 },
      model: "gpt-6-luna",
    });
  });

  it("never reports a negative uncached input when cached exceeds input", () => {
    const result = buildAgentHostTurnUsage(usage({ tokens: { input: 10, cached: 12, output: 1 } }));

    expect(result.uncachedInput).toEqual({ known: true, value: 0 });
  });

  it("marks the figures the Agent Host doesn't record as unknown, not 0", () => {
    const result = buildAgentHostTurnUsage(usage());

    for (const field of ["cacheWrite", "tool", "vision", "reasoning"] as const) {
      expect(result[field]).toEqual({ known: false, reason: AGENT_HOST_FIELD_NOT_RECORDED_REASON });
    }
    expect(result.roundsCount).toBeUndefined();
  });

  it("keeps the AI Credits when the turn has no token totals", () => {
    const result = buildAgentHostTurnUsage(usage({ tokens: null }));

    expect(result.uncachedInput).toEqual({ known: false, reason: AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON });
    expect(result.cacheRead).toEqual({ known: false, reason: AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON });
    expect(result.output).toEqual({ known: false, reason: AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON });
    expect(result.costAiCredits).toEqual({ known: true, value: 1.5 });
  });

  it("keeps the tokens when the turn has no AI Credits", () => {
    const result = buildAgentHostTurnUsage(usage({ nanoAiu: null }));

    expect(result.costAiCredits).toEqual({ known: false, reason: AGENT_HOST_TURN_COST_UNAVAILABLE_REASON });
    expect(result.output).toEqual({ known: true, value: 50 });
  });

  it("reports a turn with a zero-credit record as a known 0", () => {
    expect(buildAgentHostTurnUsage(usage({ nanoAiu: 0 })).costAiCredits).toEqual({ known: true, value: 0 });
  });

  it("makes every figure unknown for a turn without a usage record", () => {
    const result = buildAgentHostTurnUsage(null);

    expect(result.uncachedInput).toEqual({ known: false, reason: AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON });
    expect(result.output).toEqual({ known: false, reason: AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON });
    expect(result.costAiCredits).toEqual({ known: false, reason: AGENT_HOST_TURN_COST_UNAVAILABLE_REASON });
    expect(result.model).toBe("unknown");
  });

  it("names the model unknown when the usage record has none", () => {
    expect(buildAgentHostTurnUsage(usage({ model: null })).model).toBe("unknown");
  });
});

describe("buildAgentHostSession", () => {
  const store = {
    turns: [turn(1, usage({ nanoAiu: 1_000_000_000 })), turn(2, usage({ nanoAiu: 250_000_000, model: "claude-sonnet-5" }))],
    model: "gpt-6-luna",
    title: "Custom title",
  };

  it("builds a schema-valid analyze-mode session from the catalog row and its session.db", () => {
    const session = buildAgentHostSession({ catalogRow, store });

    expect(() => sessionSchema.parse(session)).not.toThrow();
    expect(session).toMatchObject({
      id: catalogRow.id,
      mode: "analyze",
      startedAt: "2026-10-01T12:00:00.000Z",
      turnCount: 2,
      costAiCredits: { known: true, value: 1.25 },
      usageDataAvailable: true,
    });
    expect(session.providerId).toBeUndefined();
  });

  it("marks the session as coming from the Agent Host", () => {
    expect(buildAgentHostSession({ catalogRow, store }).copilotHarness).toBe("agent-host");
    expect(buildAgentHostSession({ catalogRow, store: null }).copilotHarness).toBe("agent-host");
  });

  it("numbers the turns in session.db order with empty text and no tool calls", () => {
    const session = buildAgentHostSession({ catalogRow, store });

    expect(session.turns.map((t) => t.index)).toEqual([0, 1]);
    for (const built of session.turns) {
      expect(built.userMessage).toBe("");
      expect(built.assistantResponse).toBe("");
      expect(built.toolCalls).toEqual([]);
      expect(built.explanation).toContain(AGENT_HOST_TURN_TEXT_UNAVAILABLE_NOTE);
    }
    expect(session.turns[1].usage.model).toBe("claude-sonnet-5");
  });

  it("explains a turn's tokens like a classic turn does", () => {
    const [first] = buildAgentHostSession({ catalogRow, store }).turns;

    expect(first.explanation).toMatch(/^This turn sent 200 new input token\(s\) and reused 800 from cache, producing 50 output token\(s\) using gpt-6-luna\./);
  });

  it("explains a turn without token totals by its reason", () => {
    const session = buildAgentHostSession({ catalogRow, store: { ...store, turns: [turn(1, null)] } });

    expect(session.turns[0].explanation).toContain(AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON);
    expect(session.turns[0].explanation).toContain(AGENT_HOST_TURN_TEXT_UNAVAILABLE_NOTE);
  });

  it("leaves the system prompt and tool inventory unset, since the Agent Host doesn't record them", () => {
    const session = buildAgentHostSession({ catalogRow, store });

    expect(session.systemPrompt).toBeUndefined();
    expect(session.toolInventory).toBeUndefined();
  });

  it("makes the session total unknown when any turn has no AI Credits (all-or-nothing)", () => {
    const session = buildAgentHostSession({ catalogRow, store: { ...store, turns: [turn(1), turn(2, null)] } });

    expect(session.costAiCredits).toEqual({ known: false, reason: AGENT_HOST_SESSION_COST_UNAVAILABLE_REASON });
    expect(session.usageDataAvailable).toBe(true);
  });

  it("reports no usage data when no turn has a usage record", () => {
    const session = buildAgentHostSession({ catalogRow, store: { ...store, turns: [turn(1, null)] } });

    expect(session.usageDataAvailable).toBe(false);
  });

  it("makes the cost of a session without turns unknown, not 0", () => {
    const session = buildAgentHostSession({ catalogRow, store: { ...store, turns: [] } });

    expect(session.turnCount).toBe(0);
    expect(session.costAiCredits).toEqual({ known: false, reason: AGENT_HOST_NO_TURNS_REASON });
    expect(session.usageDataAvailable).toBe(false);
  });

  it("makes the cost unknown with its own reason when the session's session.db is missing", () => {
    const session = buildAgentHostSession({ catalogRow, store: null });

    expect(session).toMatchObject({
      title: "Refactor billing module",
      model: "unknown",
      turnCount: 0,
      turns: [],
      costAiCredits: { known: false, reason: AGENT_HOST_SESSION_DB_MISSING_REASON },
      usageDataAvailable: false,
    });
  });

  describe("title", () => {
    it("prefers session.db's custom title", () => {
      expect(buildAgentHostSession({ catalogRow, store }).title).toBe("Custom title");
    });

    it("falls back to the catalog title", () => {
      expect(buildAgentHostSession({ catalogRow, store: { ...store, title: null } }).title).toBe("Refactor billing module");
    });

    it("falls back to the classic session's placeholder title", () => {
      const session = buildAgentHostSession({ catalogRow: { ...catalogRow, title: null }, store: { ...store, title: null } });

      expect(session.title).toBe(`Session ${catalogRow.id}`);
    });
  });

  describe("model", () => {
    it("prefers session.db's selected model", () => {
      expect(buildAgentHostSession({ catalogRow, store }).model).toBe("gpt-6-luna");
    });

    it("falls back to the last turn with a known model", () => {
      const session = buildAgentHostSession({
        catalogRow,
        store: { ...store, model: null, turns: [turn(1, usage({ model: "a" })), turn(2, usage({ model: "b" })), turn(3, null)] },
      });

      expect(session.model).toBe("b");
    });

    it("is unknown when neither names one", () => {
      const session = buildAgentHostSession({ catalogRow, store: { ...store, model: null, turns: [turn(1, null)] } });

      expect(session.model).toBe("unknown");
    });
  });

  it("leaves startedAt out when the catalog's start time isn't a valid instant", () => {
    const session = buildAgentHostSession({ catalogRow: { ...catalogRow, startedAtMs: Number.NaN }, store });

    expect(session.startedAt).toBeUndefined();
  });
});

describe("buildAgentHostSessionSummary", () => {
  it("is the full session without its turns, as the classic list summary is", () => {
    const store = { turns: [turn(1), turn(2)], model: null, title: null };

    const summary = buildAgentHostSessionSummary({ catalogRow, store });

    expect(summary.turns).toEqual([]);
    expect(summary.copilotHarness).toBe("agent-host");
    expect(summary.turnCount).toBe(2);
    expect(summary.costAiCredits).toEqual({ known: true, value: 3 });
    expect(() => sessionSchema.parse(summary)).not.toThrow();
  });
});
