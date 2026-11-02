import { beforeAll, describe, expect, it } from "vitest";
import { sessionSchema, turnInspectorDetailSchema, type TokenCount } from "@agent-cost-analyzer/domain";
import type { AgentHostSessionRow } from "../../data-sources/agent-host/agent-host-catalog.js";
import type { AgentHostTurnRow, AgentHostTurnUsage } from "../../data-sources/agent-host/agent-session-store.js";
import { copilotEventLogPath } from "../../data-sources/agent-host/copilot-cli-paths.js";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import { readCopilotEventLog } from "../../data-sources/agent-host/copilot-event-log-reader.js";
import {
  COPILOT_CLI_FIXTURE_HOME,
  copilotCliFixtureRows,
  copilotCliFixtureTurnRefs,
  type CopilotCliFixtureName,
} from "../../test-support/copilot-cli-fixtures.js";
import { buildAgentHostSystemPrompt } from "./agent-host-system-prompt-builder.js";
import { buildAgentHostTurnContent, indexToolOutcomeEvents } from "./agent-host-turn-content-builder.js";
import { buildAgentHostTurnInspector } from "./agent-host-turn-inspector-builder.js";
import { segmentCopilotTurns, TURN_EVENT_ALREADY_TAKEN_REASON, TURN_EVENT_NOT_FOUND_REASON, type MatchedTurn } from "./copilot-turn-segmenter.js";
import {
  AGENT_HOST_USAGE_RECORDS_INCOMPLETE_REASON,
  AGENT_HOST_USAGE_RECORDS_MISSING_REASON,
  AGENT_HOST_CACHE_WRITE_NOT_REPORTED_REASON,
  AGENT_HOST_REASONING_NOT_REPORTED_REASON,
  type AgentHostTurnTokenDetail,
} from "./agent-host-turn-token-detail-builder.js";
import {
  AGENT_HOST_FIELD_NOT_RECORDED_REASON,
  AGENT_HOST_USAGE_RECORDS_NOT_READ_REASON,
  AGENT_HOST_NO_TURNS_REASON,
  AGENT_HOST_SESSION_COST_UNAVAILABLE_REASON,
  AGENT_HOST_SESSION_DB_MISSING_REASON,
  AGENT_HOST_TURN_COST_UNAVAILABLE_REASON,
  AGENT_HOST_TURN_TEXT_UNAVAILABLE_NOTE,
  AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON,
  buildAgentHostSession,
  buildAgentHostSessionSummary,
  buildAgentHostTurnDetail,
  buildAgentHostTurnUsage,
  isAgentHostEventTypeUsed,
  type AgentHostEventLog,
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

    for (const field of ["tool", "vision"] as const) {
      expect(result[field]).toEqual({ known: false, reason: AGENT_HOST_FIELD_NOT_RECORDED_REASON });
    }
    expect(result.roundsCount).toBeUndefined();
  });

  it("leaves cache write and reasoning unknown with the not-read note when no token detail is given", () => {
    const result = buildAgentHostTurnUsage(usage());

    for (const field of ["cacheWrite", "reasoning"] as const) {
      expect(result[field]).toEqual({ known: false, reason: AGENT_HOST_USAGE_RECORDS_NOT_READ_REASON });
    }
  });

  it("takes cache write and reasoning from the token detail and subtracts the cache write from the uncached input", () => {
    const detail: AgentHostTurnTokenDetail = { cacheWrite: { known: true, value: 150 }, reasoning: { known: true, value: 20 } };

    const result = buildAgentHostTurnUsage(usage(), detail);

    expect(result.cacheWrite).toEqual({ known: true, value: 150 });
    expect(result.reasoning).toEqual({ known: true, value: 20 });
    expect(result.uncachedInput).toEqual({ known: true, value: 50 });
    expect(result.output).toEqual({ known: true, value: 50 });
  });

  it("keeps uncached input at input minus cached when the detail's cache write is unknown", () => {
    const reason = "not reported";
    const detail: AgentHostTurnTokenDetail = { cacheWrite: { known: false, reason }, reasoning: { known: true, value: 0 } };

    const result = buildAgentHostTurnUsage(usage(), detail);

    expect(result.cacheWrite).toEqual({ known: false, reason });
    expect(result.reasoning).toEqual({ known: true, value: 0 });
    expect(result.uncachedInput).toEqual({ known: true, value: 200 });
  });

  it("never reports a negative uncached input when the cache write exceeds what's left", () => {
    const detail: AgentHostTurnTokenDetail = { cacheWrite: { known: true, value: 900 }, reasoning: { known: true, value: 0 } };

    expect(buildAgentHostTurnUsage(usage(), detail).uncachedInput).toEqual({ known: true, value: 0 });
  });

  it("ignores the token detail for a turn without token totals", () => {
    const detail: AgentHostTurnTokenDetail = { cacheWrite: { known: true, value: 5 }, reasoning: { known: true, value: 5 } };

    const result = buildAgentHostTurnUsage(usage({ tokens: null }), detail);

    expect(result.uncachedInput).toEqual({ known: false, reason: AGENT_HOST_TURN_TOKENS_UNAVAILABLE_REASON });
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

describe("with the Copilot CLI event log (step 10.14)", () => {
  const eventsOf: Partial<Record<CopilotCliFixtureName, CopilotEvent[]>> = {};
  beforeAll(async () => {
    for (const name of ["normal", "steeringAbortSubagent"] as const) {
      const logPath = copilotEventLogPath(COPILOT_CLI_FIXTURE_HOME, copilotCliFixtureRows.sdkSessionIds[name])!;
      eventsOf[name] = (await readCopilotEventLog(logPath))!.events;
    }
  });

  const read = (name: CopilotCliFixtureName): AgentHostEventLog => ({
    status: "read",
    events: eventsOf[name]!,
    turnRefs: copilotCliFixtureTurnRefs(name),
  });
  const storeFor = (name: CopilotCliFixtureName) => ({
    turns: copilotCliFixtureTurnRefs(name).map((ref) => ({ turnId: ref.turnId, usage: usage() })),
    model: null,
    title: null,
  });
  const matched = (name: CopilotCliFixtureName, index: number): MatchedTurn => {
    const turn = segmentCopilotTurns(eventsOf[name]!, copilotCliFixtureTurnRefs(name)).turns[index]!;
    if (!turn.matched) throw new Error("unmatched");
    return turn;
  };
  const missing: AgentHostEventLog = { status: "missing", reason: "The event log is missing." };

  describe("buildAgentHostSession", () => {
    it("fills each matched turn's text and tool calls and keeps its tokens and AI Credits from session.db", () => {
      const session = buildAgentHostSession({ catalogRow, store: storeFor("normal"), eventLog: read("normal") });

      expect(() => sessionSchema.parse(session)).not.toThrow();
      expect(session.copilotEventLog).toEqual({ status: "read" });
      const expected = buildAgentHostTurnContent(matched("normal", 0), { outcomes: indexToolOutcomeEvents(eventsOf.normal!) });
      expect(session.turns[0]).toMatchObject({
        userMessage: expected.userMessage,
        assistantResponse: expected.assistantResponse,
        toolCalls: expected.toolCalls,
      });
      expect(session.turns[0]!.toolCalls.length).toBeGreaterThan(0);
      // The shared usage() totals don't match this log's per-call records.
      const unknown = { known: false as const, reason: AGENT_HOST_USAGE_RECORDS_INCOMPLETE_REASON };
      expect(session.turns[0]!.usage).toEqual(buildAgentHostTurnUsage(usage(), { cacheWrite: unknown, reasoning: unknown }));
      expect(session.costAiCredits).toEqual({ known: true, value: 3 });
    });

    it("drops the not-read note from a matched turn's explanation and sets no unknown reasons", () => {
      const [first] = buildAgentHostSession({ catalogRow, store: storeFor("normal"), eventLog: read("normal") }).turns;

      expect(first!.explanation).not.toContain(AGENT_HOST_TURN_TEXT_UNAVAILABLE_NOTE);
      expect(first!.textUnavailableReason).toBeUndefined();
      expect(first!.toolCallsUnavailableReason).toBeUndefined();
    });

    it("finds a steered call's completion in the next turn", () => {
      const session = buildAgentHostSession({ catalogRow, store: storeFor("steeringAbortSubagent"), eventLog: read("steeringAbortSubagent") });

      expect(session.turns[1]!.toolCalls[0]).toMatchObject({ id: "toolu_B3", outcome: { status: "success", exitCode: 0 } });
    });

    it("keeps an unmatched turn's text and tool calls unknown with the segmenter's reason", () => {
      const session = buildAgentHostSession({ catalogRow, store: storeFor("steeringAbortSubagent"), eventLog: read("steeringAbortSubagent") });
      const duplicate = session.turns[4]!;

      expect(duplicate).toMatchObject({
        userMessage: "",
        toolCalls: [],
        textUnavailableReason: TURN_EVENT_ALREADY_TAKEN_REASON,
        toolCallsUnavailableReason: TURN_EVENT_ALREADY_TAKEN_REASON,
      });
      expect(duplicate.explanation).toContain(TURN_EVENT_ALREADY_TAKEN_REASON);
    });

    it("sets the system prompt from the log, and leaves the tool inventory unset", () => {
      const session = buildAgentHostSession({ catalogRow, store: storeFor("normal"), eventLog: read("normal") });

      expect(session.systemPrompt).toEqual(buildAgentHostSystemPrompt(eventsOf.normal!)!.components);
      expect(session.toolInventory).toBeUndefined();
    });

    it("marks a missing or unreadable log with its reason and explains every turn by it", () => {
      for (const eventLog of [missing, { status: "unreadable", reason: "The event log can't be read." } as const]) {
        const session = buildAgentHostSession({ catalogRow, store: storeFor("normal"), eventLog });

        expect(session.copilotEventLog).toEqual(eventLog);
        expect(session.systemPrompt).toBeUndefined();
        for (const turn of session.turns) {
          expect(turn.userMessage).toBe("");
          expect(turn.toolCalls).toEqual([]);
          expect(turn.explanation).toContain(eventLog.reason);
        }
      }
    });

    it("sets no marker when the log wasn't read (a list summary)", () => {
      const session = buildAgentHostSession({ catalogRow, store: storeFor("normal") });

      expect(session.copilotEventLog).toBeUndefined();
      expect(session.turns[0]!.explanation).toContain(AGENT_HOST_TURN_TEXT_UNAVAILABLE_NOTE);
    });

    it("keeps the marker on the summary", () => {
      expect(buildAgentHostSessionSummary({ catalogRow, store: storeFor("normal"), eventLog: missing }).copilotEventLog).toEqual({
        status: "missing",
        reason: missing.reason,
      });
    });
  });

  it("builds the same session and turn details from a log read with only the event types it uses", async () => {
    for (const name of ["normal", "steeringAbortSubagent"] as const) {
      const logPath = copilotEventLogPath(COPILOT_CLI_FIXTURE_HOME, copilotCliFixtureRows.sdkSessionIds[name])!;
      const filtered = (await readCopilotEventLog(logPath, { include: isAgentHostEventTypeUsed }))!.events;
      const filteredLog: AgentHostEventLog = { status: "read", events: filtered, turnRefs: copilotCliFixtureTurnRefs(name) };

      expect(filtered.length).toBeLessThan(eventsOf[name]!.length);
      expect(buildAgentHostSession({ catalogRow, store: storeFor(name), eventLog: filteredLog })).toEqual(
        buildAgentHostSession({ catalogRow, store: storeFor(name), eventLog: read(name) }),
      );
      for (let index = 0; index < storeFor(name).turns.length; index++) {
        expect(buildAgentHostTurnDetail(index, filteredLog)).toEqual(buildAgentHostTurnDetail(index, read(name)));
      }
    }
  });

  describe("usage records (step 10.15)", () => {
    interface ExpectedTurn {
      cacheWrite: number | null;
      reasoning: number | null;
      reason?: "records-missing" | "records-incomplete" | "not-reported";
    }
    interface FixtureTurnUsage {
      turn_id: string;
      usage: {
        model: string;
        _meta: { turnTokenTotals: { inputTokens: number; cachedTokens: number; outputTokens: number }[]; copilotUsage: { totalNanoAiu: number } };
      };
    }
    const fixtureRows = copilotCliFixtureRows as unknown as {
      turnUsage: { usageRecords: FixtureTurnUsage[] };
      expected: { usageRecords: ExpectedTurn[] };
    };
    const expectedTurns = fixtureRows.expected.usageRecords;
    const totalsOf = (row: FixtureTurnUsage) => row.usage._meta.turnTokenTotals[0]!;
    const recordsStore = {
      turns: fixtureRows.turnUsage.usageRecords.map((row) => ({
        turnId: row.turn_id,
        usage: {
          tokens: { input: totalsOf(row).inputTokens, cached: totalsOf(row).cachedTokens, output: totalsOf(row).outputTokens },
          model: row.usage.model,
          nanoAiu: row.usage._meta.copilotUsage.totalNanoAiu,
        },
      })),
      model: null,
      title: null,
    };
    let recordsLog: AgentHostEventLog;
    beforeAll(async () => {
      const logPath = copilotEventLogPath(COPILOT_CLI_FIXTURE_HOME, copilotCliFixtureRows.sdkSessionIds.usageRecords)!;
      const events = (await readCopilotEventLog(logPath, { include: isAgentHostEventTypeUsed }))!.events;
      recordsLog = { status: "read", events, turnRefs: copilotCliFixtureTurnRefs("usageRecords") };
    });

    const reasonFor = (reason: ExpectedTurn["reason"]) =>
      ({
        "records-missing": AGENT_HOST_USAGE_RECORDS_MISSING_REASON,
        "records-incomplete": AGENT_HOST_USAGE_RECORDS_INCOMPLETE_REASON,
        "not-reported": AGENT_HOST_CACHE_WRITE_NOT_REPORTED_REASON,
      })[reason!];
    const count = (value: number | null, reason: string) => (value === null ? { known: false, reason } : { known: true, value });

    it("reads session.usage_record events", () => {
      expect(isAgentHostEventTypeUsed("session.usage_record")).toBe(true);
      expect(recordsLog.status === "read" && recordsLog.events.some((event) => event.type === "session.usage_record")).toBe(true);
    });

    it("gives each turn the cache write and reasoning the fixture expects, or the reason it can't", () => {
      const session = buildAgentHostSession({ catalogRow, store: recordsStore, eventLog: recordsLog });

      expect(() => sessionSchema.parse(session)).not.toThrow();
      expectedTurns.forEach((expected, index) => {
        const usage = session.turns[index]!.usage;
        expect(usage.cacheWrite, `turn ${index} cache write`).toEqual(count(expected.cacheWrite, reasonFor(expected.reason)));
        const reasoningReason = expected.reason === "not-reported" ? AGENT_HOST_REASONING_NOT_REPORTED_REASON : reasonFor(expected.reason);
        expect(usage.reasoning, `turn ${index} reasoning`).toEqual(count(expected.reasoning, reasoningReason));
      });
    });

    it("keeps total input equal to session.db's input when the cache write is known", () => {
      const session = buildAgentHostSession({ catalogRow, store: recordsStore, eventLog: recordsLog });
      const usage = session.turns[0]!.usage;
      const value = (count: TokenCount) => (count.known ? count.value : NaN);

      expect(value(usage.uncachedInput) + value(usage.cacheWrite) + value(usage.cacheRead)).toBe(recordsStore.turns[0]!.usage.tokens.input);
    });

    it("leaves input at input minus cached for turns whose cache write is unknown", () => {
      const session = buildAgentHostSession({ catalogRow, store: recordsStore, eventLog: recordsLog });

      session.turns.forEach((turn, index) => {
        if (expectedTurns[index]!.cacheWrite === null) {
          const { input, cached } = recordsStore.turns[index]!.usage.tokens;
          expect(turn.usage.uncachedInput).toEqual({ known: true, value: input - cached });
        }
      });
    });

    it("leaves a turn unknown when session.db recorded no token totals for it", () => {
      const store = { ...recordsStore, turns: recordsStore.turns.map((row) => ({ ...row, usage: { ...row.usage, tokens: null } })) };

      const session = buildAgentHostSession({ catalogRow, store, eventLog: recordsLog });

      expect(session.turns[0]!.usage.cacheWrite.known).toBe(false);
      expect(session.turns[0]!.usage.reasoning.known).toBe(false);
    });

    it("leaves a turn unknown when it has records but no turn_usage row", () => {
      const store = { ...recordsStore, turns: recordsStore.turns.map((row) => ({ ...row, usage: null })) };

      const session = buildAgentHostSession({ catalogRow, store, eventLog: recordsLog });

      expect(session.turns[0]!.usage.cacheWrite.known).toBe(false);
    });

    it("gives the log's reason when the log is missing, and the not-read note without a log", () => {
      const withMissing = buildAgentHostSession({ catalogRow, store: recordsStore, eventLog: missing });
      const withoutLog = buildAgentHostSession({ catalogRow, store: recordsStore });

      for (const field of ["cacheWrite", "reasoning"] as const) {
        expect(withMissing.turns[0]!.usage[field]).toEqual({ known: false, reason: missing.reason });
        expect(withoutLog.turns[0]!.usage[field]).toEqual({ known: false, reason: AGENT_HOST_USAGE_RECORDS_NOT_READ_REASON });
      }
    });

    it("gives the segmenter's reason for an unmatched turn", () => {
      const eventLog: AgentHostEventLog = { ...(recordsLog as Extract<AgentHostEventLog, { status: "read" }>), turnRefs: [] };

      const session = buildAgentHostSession({ catalogRow, store: recordsStore, eventLog });

      expect(session.turns[0]!.usage.cacheWrite).toEqual({ known: false, reason: TURN_EVENT_NOT_FOUND_REASON });
    });
  });

  describe("buildAgentHostTurnDetail", () => {
    it("is the inspector rounds of a matched turn", () => {
      const detail = buildAgentHostTurnDetail(1, read("normal"));

      expect(detail).toEqual(buildAgentHostTurnInspector(1, matched("normal", 1)));
      expect(detail.rounds.length).toBeGreaterThan(0);
      expect(detail.unavailableReason).toBeUndefined();
    });

    it("is unknown with the segmenter's reason for an unmatched turn", () => {
      const detail = buildAgentHostTurnDetail(4, read("steeringAbortSubagent"));

      expect(detail).toEqual({ turnIndex: 4, userMessage: [], rounds: [], unavailableReason: TURN_EVENT_ALREADY_TAKEN_REASON });
      expect(() => turnInspectorDetailSchema.parse(detail)).not.toThrow();
    });

    it("is unknown with the log's reason when the log wasn't read", () => {
      expect(buildAgentHostTurnDetail(0, missing)).toEqual({ turnIndex: 0, userMessage: [], rounds: [], unavailableReason: missing.reason });
    });
  });
});
