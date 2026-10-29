import { beforeAll, describe, expect, it } from "vitest";
import { sessionSchema, turnInspectorDetailSchema } from "@agent-cost-analyzer/domain";
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
import { segmentCopilotTurns, TURN_EVENT_ALREADY_TAKEN_REASON, type MatchedTurn } from "./copilot-turn-segmenter.js";
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
      expect(session.turns[0]!.usage).toEqual(buildAgentHostTurnUsage(usage()));
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
