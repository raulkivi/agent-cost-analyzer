import { describe, expect, it } from "vitest";
import {
  sessionSchema,
  type SystemPromptComponent,
  type ToolInventoryEntry,
  type TurnUsage,
} from "@agent-cost-analyzer/domain";
import type {
  SessionFileRow,
  SessionRow,
  TurnRow,
} from "../../data-sources/sqlite/session-store.js";
import {
  buildSession,
  buildSessionSummary,
  LOGGING_NEVER_ENABLED_REASON,
  PARSE_FAILURES_REASON,
  STORE_TURN_MISSING_REASON,
  summarizeSessionUsage,
  TOOL_CALL_TOKEN_COUNT_UNAVAILABLE_REASON,
  STORE_NO_FOLDER_REASON,
  USAGE_UNAVAILABLE_REASON,
} from "./session-enricher.js";

const sessionRow: SessionRow = {
  id: "session-1",
  cwd: "/repo",
  repository: "org/repo",
  branch: "main",
  host_type: "desktop",
  summary: "Fix the bug",
  agent_name: "GitHub Copilot Chat",
  agent_description: "chat",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  turn_count: 3,
};

describe("buildSessionSummary", () => {
  it("produces a schema-valid Session with no turns and usage unavailable", () => {
    const session = buildSessionSummary(sessionRow);

    expect(() => sessionSchema.parse(session)).not.toThrow();
    expect(session.id).toBe("session-1");
    expect(session.mode).toBe("analyze");
    expect(session.title).toBe("Fix the bug");
    expect(session.turns).toEqual([]);
    expect(session.usageDataAvailable).toBe(false);
  });

  it("marks the session as coming from the classic store", () => {
    expect(buildSessionSummary(sessionRow).copilotHarness).toBe("local");
  });

  it("populates turnCount from the row's turn_count, independent of the (intentionally empty) turns array", () => {
    const session = buildSessionSummary(sessionRow);

    expect(session.turnCount).toBe(3);
    expect(session.turns).toEqual([]);
  });

  it("falls back to repository, then cwd, then a generated title when summary is missing", () => {
    expect(buildSessionSummary({ ...sessionRow, summary: null }).title).toBe(
      "org/repo",
    );
    expect(
      buildSessionSummary({ ...sessionRow, summary: null, repository: null })
        .title,
    ).toBe("/repo");
    expect(
      buildSessionSummary({
        ...sessionRow,
        summary: null,
        repository: null,
        cwd: null,
      }).title,
    ).toBe("Session session-1");
  });

  it("surfaces created_at as Session.startedAt", () => {
    expect(buildSessionSummary(sessionRow).startedAt).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("omits startedAt when created_at is null", () => {
    expect(
      buildSessionSummary({ ...sessionRow, created_at: null }).startedAt,
    ).toBeUndefined();
  });

  it("reports the store's folder, repository and branch as the workspace (step 15.1)", () => {
    expect(buildSessionSummary(sessionRow).workspace).toEqual({
      known: true,
      cwd: "/repo",
      repositoryHint: "org/repo",
      branch: "main",
    });
  });

  it("keeps the folder when the store has no repository or branch", () => {
    expect(buildSessionSummary({ ...sessionRow, repository: null, branch: "" }).workspace).toEqual({ known: true, cwd: "/repo" });
  });

  it("says why the workspace is unknown when the store row has no folder", () => {
    expect(buildSessionSummary({ ...sessionRow, cwd: null }).workspace).toEqual({
      known: false,
      reason: STORE_NO_FOLDER_REASON,
    });
  });

  it("defaults costAiCredits to unavailable when not passed", () => {
    expect(buildSessionSummary(sessionRow).costAiCredits).toEqual({
      known: false,
      reason: USAGE_UNAVAILABLE_REASON,
    });
  });

  it("uses the passed-in usage figures when provided", () => {
    const session = buildSessionSummary(sessionRow, {
      turnCount: 4,
      costAiCredits: { known: true, value: 4.2 },
      model: "claude-sonnet-5",
      usageDataAvailable: true,
    });

    expect(session).toMatchObject({
      turnCount: 4,
      costAiCredits: { known: true, value: 4.2 },
      model: "claude-sonnet-5",
      usageDataAvailable: true,
      turns: [],
    });
  });
});

describe("summarizeSessionUsage", () => {
  const known = (value: number, model = "claude-sonnet-5"): TurnUsage =>
    ({ costAiCredits: { known: true, value }, model }) as TurnUsage;
  const unknown = (): TurnUsage =>
    ({ costAiCredits: { known: false, reason: "no data" }, model: "claude-sonnet-5" }) as TurnUsage;

  it("is unavailable, with the log's own reason, when main.jsonl has no usage events", () => {
    expect(summarizeSessionUsage("missing", [0], []).costAiCredits).toEqual({
      known: false,
      reason: USAGE_UNAVAILABLE_REASON,
    });
    expect(summarizeSessionUsage("logging-never-enabled", [0], []).costAiCredits).toEqual({
      known: false,
      reason: LOGGING_NEVER_ENABLED_REASON,
    });
  });

  it("is unavailable, not 0, when the session has no turns at all", () => {
    expect(summarizeSessionUsage("events-present", [], []).costAiCredits).toEqual({
      known: false,
      reason: USAGE_UNAVAILABLE_REASON,
    });
  });

  it("sums known costAiCredits across every turn", () => {
    expect(summarizeSessionUsage("events-present", [0, 1], [known(1.5), known(2.25)]).costAiCredits).toEqual({
      known: true,
      value: 3.75,
    });
  });

  it("is unavailable if any turn's cost, or a null turn, is unknown", () => {
    expect(summarizeSessionUsage("events-present", [0, 1], [known(1), null]).costAiCredits).toEqual({
      known: false,
      reason: USAGE_UNAVAILABLE_REASON,
    });
    expect(summarizeSessionUsage("events-present", [0, 1], [known(1), unknown()]).costAiCredits).toEqual({
      known: false,
      reason: USAGE_UNAVAILABLE_REASON,
    });
  });

  it("counts a debug-log turn the session store has no row for, in the cost and the turn count", () => {
    const figures = summarizeSessionUsage("events-present", [0], [known(1.5), known(2.25, "gpt-6")]);

    expect(figures).toEqual({
      turnCount: 2,
      costAiCredits: { known: true, value: 3.75 },
      model: "gpt-6",
      usageDataAvailable: true,
    });
  });

  it("is unavailable when a session-store turn has no usage in the debug log", () => {
    const figures = summarizeSessionUsage("events-present", [0, 1, 2], [known(1.5)]);

    expect(figures.turnCount).toBe(3);
    expect(figures.costAiCredits).toEqual({ known: false, reason: USAGE_UNAVAILABLE_REASON });
  });

  it("reports the model and usage availability as unknown when no turn has usage", () => {
    expect(summarizeSessionUsage("missing", [0, 1], [])).toMatchObject({ model: "unknown", usageDataAvailable: false, turnCount: 2 });
  });
});

describe("buildSession", () => {
  const turnRows: TurnRow[] = [
    {
      id: 1,
      session_id: "session-1",
      turn_index: 0,
      user_message: "first",
      assistant_response: "first reply",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    {
      id: 2,
      session_id: "session-1",
      turn_index: 1,
      user_message: "hi",
      assistant_response: "hello",
      timestamp: "2026-01-01T00:00:01.000Z",
    },
  ];
  const fileRows: SessionFileRow[] = [
    {
      id: 1,
      session_id: "session-1",
      file_path: "src/a.ts",
      tool_name: "read_file",
      turn_index: 0,
      first_seen_at: "2026-01-01T00:00:00.500Z",
    },
    {
      id: 2,
      session_id: "session-1",
      file_path: "src/b.ts",
      tool_name: "read_file",
      turn_index: 0,
      first_seen_at: "2026-01-01T00:00:00.600Z",
    },
    {
      id: 3,
      session_id: "session-1",
      file_path: "src/c.ts",
      tool_name: "edit_file",
      turn_index: 1,
      first_seen_at: "2026-01-01T00:00:01.500Z",
    },
  ];
  it("produces a schema-valid Session with real turns", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "missing",
    });

    expect(() => sessionSchema.parse(session)).not.toThrow();
    expect(session.mode).toBe("analyze");
    expect(session.usageDataAvailable).toBe(false);
    expect(session.turns).toHaveLength(2);
  });

  it("stamps each store turn with its timestamp, and leaves a log-only turn without one (step 15.1)", () => {
    const session = buildSession({ sessionRow, turnRows, fileRows, mainJsonlAvailability: "missing" });

    expect(session.turns.map((turn) => turn.startedAt)).toEqual(["2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z"]);
    expect(session.workspace).toEqual(buildSessionSummary(sessionRow).workspace);
    const untimed = buildSession({ sessionRow, turnRows: [{ ...turnRows[0], timestamp: null }], fileRows: [], mainJsonlAvailability: "missing" });
    expect(untimed.turns[0]).not.toHaveProperty("startedAt");
  });

  it("sets turnCount from the actual turns loaded, not the row's turn_count", () => {
    // sessionRow.turn_count is 3 (a summary-list value); the real turnRows
    // loaded here has 2 entries, which must win.
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "missing",
    });

    expect(session.turnCount).toBe(2);
  });

  it("maps user/assistant messages and marks every usage field known:false", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "missing",
    });
    const [firstTurn] = session.turns;

    expect(firstTurn.index).toBe(0);
    expect(firstTurn.userMessage).toBe("first");
    expect(firstTurn.assistantResponse).toBe("first reply");
    for (const field of [
      "uncachedInput",
      "cacheWrite",
      "cacheRead",
      "tool",
      "vision",
      "reasoning",
      "output",
      "costAiCredits",
    ] as const) {
      expect(firstTurn.usage[field]).toEqual({
        known: false,
        reason: USAGE_UNAVAILABLE_REASON,
      });
    }
    expect(firstTurn.usage.model).toBe("unknown");
  });

  it("groups session_files into toolCalls per turn by tool_name, token count marked unavailable", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "missing",
    });
    const [firstTurn, secondTurn] = session.turns;

    expect(firstTurn.toolCalls).toEqual([
      {
        name: "read_file",
        argsSummary: "src/a.ts, src/b.ts",
        filesTouched: ["src/a.ts", "src/b.ts"],
        tokenCount: {
          known: false,
          reason: TOOL_CALL_TOKEN_COUNT_UNAVAILABLE_REASON,
        },
      },
    ]);
    expect(secondTurn.toolCalls).toEqual([
      {
        name: "edit_file",
        argsSummary: "src/c.ts",
        filesTouched: ["src/c.ts"],
        tokenCount: {
          known: false,
          reason: TOOL_CALL_TOKEN_COUNT_UNAVAILABLE_REASON,
        },
      },
    ]);
  });

  it("handles a turn with no touched files", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows: [],
      mainJsonlAvailability: "missing",
    });

    expect(session.turns[0].toolCalls).toEqual([]);
  });

  it("merges a jsonl-only tool invocation (no touched files) into toolCalls, token count unavailable", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "missing",
      invokedToolNamesByTurn: [["read_file", "manage_todo_list"], []],
    });
    const [firstTurn] = session.turns;

    expect(firstTurn.toolCalls).toEqual([
      {
        name: "read_file",
        argsSummary: "src/a.ts, src/b.ts",
        filesTouched: ["src/a.ts", "src/b.ts"],
        tokenCount: {
          known: false,
          reason: TOOL_CALL_TOKEN_COUNT_UNAVAILABLE_REASON,
        },
      },
      {
        name: "manage_todo_list",
        argsSummary: "",
        tokenCount: {
          known: false,
          reason: TOOL_CALL_TOKEN_COUNT_UNAVAILABLE_REASON,
        },
      },
    ]);
  });

  it("keeps one record per jsonl tool_call invocation instead of deduping by name (audit count fidelity)", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "missing",
      // Same shape as fixtures/jsonl/real-session-with-usage.jsonl: the same
      // tool invoked twice in one turn.
      invokedToolNamesByTurn: [["read_file", "read_file", "manage_todo_list", "manage_todo_list"], []],
    });

    expect(session.turns[0].toolCalls.map((call) => [call.name, call.filesTouched ?? []])).toEqual([
      ["read_file", ["src/a.ts", "src/b.ts"]],
      ["read_file", []],
      ["manage_todo_list", []],
      ["manage_todo_list", []],
    ]);
  });

  it("populates session.systemPrompt and session.toolInventory from the passed-in breakdown/inventory", () => {
    const systemPrompt: SystemPromptComponent[] = [
      {
        kind: "built-in",
        label: "Base system prompt (100 characters)",
        tokenCount: { known: false, reason: "not broken down" },
      },
    ];
    const toolInventory: ToolInventoryEntry[] = [
      { name: "read_file", loaded: true, invokedInTurns: [0] },
    ];

    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "missing",
      systemPrompt,
      toolInventory,
    });

    expect(session.systemPrompt).toEqual(systemPrompt);
    expect(session.toolInventory).toEqual(toolInventory);
  });

  it("defaults session.systemPrompt and session.toolInventory to empty arrays when omitted", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "missing",
    });

    expect(session.systemPrompt).toEqual([]);
    expect(session.toolInventory).toEqual([]);
  });

  it("uses the actionable reason when logging was never enabled for this session", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "logging-never-enabled",
    });

    expect(session.turns[0].usage.uncachedInput).toEqual({
      known: false,
      reason: LOGGING_NEVER_ENABLED_REASON,
    });
  });

  it("uses the parse-failures reason (distinct from logging-never-enabled) when the log has content but nothing parsed", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "parse-failures",
    });

    expect(session.turns[0].usage.uncachedInput).toEqual({
      known: false,
      reason: PARSE_FAILURES_REASON,
    });
  });

  it("uses the generic reason when main.jsonl is missing", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "missing",
    });

    expect(session.turns[0].usage.uncachedInput).toEqual({
      known: false,
      reason: USAGE_UNAVAILABLE_REASON,
    });
  });

  it("uses the generic reason when events are present but no turn usages were extracted", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "events-present",
    });

    expect(session.turns[0].usage.uncachedInput).toEqual({
      known: false,
      reason: USAGE_UNAVAILABLE_REASON,
    });
    expect(session.usageDataAvailable).toBe(false);
  });

  const knownUsage: TurnUsage = {
    uncachedInput: { known: true, value: 21370 },
    cacheWrite: { known: false, reason: "not exposed" },
    cacheRead: { known: true, value: 42559 },
    tool: { known: false, reason: "not exposed" },
    vision: { known: false, reason: "not exposed" },
    reasoning: { known: false, reason: "not exposed" },
    output: { known: true, value: 1146 },
    costAiCredits: { known: false, reason: "not available" },
    model: "claude-sonnet-5",
  };

  it("populates a turn's real usage numbers when extraction found them, and sets usageDataAvailable", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "events-present",
      turnUsages: [knownUsage],
    });

    expect(session.turns[0].usage).toEqual(knownUsage);
    expect(session.usageDataAvailable).toBe(true);
  });

  it("writes a non-stub, numbers-based explanation for a turn with known usage", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "events-present",
      turnUsages: [knownUsage],
    });

    expect(session.turns[0].explanation).not.toBe(
      "Token and AI Credits usage data is not available for this turn (main.jsonl parsing is not implemented yet).",
    );
    expect(session.turns[0].explanation).toContain("21,370");
    expect(session.turns[0].explanation).toContain("42,559");
    expect(session.turns[0].explanation).toContain("1,146");
    expect(session.turns[0].explanation).toContain("claude-sonnet-5");
  });

  it("degrades a single turn to the fallback reason when only some turns in the session got extracted usage", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "events-present",
      turnUsages: [knownUsage, null],
    });

    expect(session.turns[0].usage).toEqual(knownUsage);
    expect(session.turns[1].usage.uncachedInput).toEqual({
      known: false,
      reason: USAGE_UNAVAILABLE_REASON,
    });
    expect(session.usageDataAvailable).toBe(true);
  });

  it("sums costAiCredits across every turn into Session.costAiCredits when all turns have a known cost", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "events-present",
      turnUsages: [
        { ...knownUsage, costAiCredits: { known: true, value: 1.5 } },
        { ...knownUsage, costAiCredits: { known: true, value: 2.25 } },
      ],
    });

    expect(session.costAiCredits).toEqual({ known: true, value: 3.75 });
  });

  it("leaves Session.costAiCredits unavailable when any turn's cost is unknown", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "events-present",
      turnUsages: [knownUsage],
    });

    expect(session.costAiCredits).toEqual({
      known: false,
      reason: USAGE_UNAVAILABLE_REASON,
    });
  });

  it("derives Session.model from the last turn with known usage", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "events-present",
      turnUsages: [knownUsage, { ...knownUsage, model: "gpt-4o-mini" }],
    });

    expect(session.model).toBe("gpt-4o-mini");
  });

  describe("a debug-log turn the session store has no row for (interrupted or still running)", () => {
    const priced = (value: number): TurnUsage => ({ ...knownUsage, costAiCredits: { known: true, value } });
    const build = () =>
      buildSession({
        sessionRow,
        turnRows: [turnRows[0]],
        fileRows: fileRows.filter((row) => row.turn_index === 0),
        mainJsonlAvailability: "events-present",
        turnUsages: [priced(1.5), priced(2.25)],
        invokedToolNamesByTurn: [[], ["run_in_terminal"]],
      });

    it("adds it as a turn with its usage and tool calls, and says why its text is missing", () => {
      const session = build();

      expect(() => sessionSchema.parse(session)).not.toThrow();
      expect(session.turns.map((turn) => turn.index)).toEqual([0, 1]);
      const logOnly = session.turns[1];
      expect(logOnly.usage).toEqual(priced(2.25));
      expect(logOnly.userMessage).toBe("");
      expect(logOnly.assistantResponse).toBe("");
      expect(logOnly.textUnavailableReason).toBe(STORE_TURN_MISSING_REASON);
      expect(logOnly.explanation).toContain(STORE_TURN_MISSING_REASON);
      expect(logOnly.toolCalls.map((call) => call.name)).toEqual(["run_in_terminal"]);
      expect(session.turns[0].textUnavailableReason).toBeUndefined();
    });

    it("counts it in the session's AI Credits and turn count, as the list summary does", () => {
      const session = build();

      expect(session.costAiCredits).toEqual({ known: true, value: 3.75 });
      expect(session.turnCount).toBe(2);
      expect({ ...session, turns: [], systemPrompt: undefined, toolInventory: undefined }).toEqual({
        ...buildSessionSummary(sessionRow, summarizeSessionUsage("events-present", [0], [priced(1.5), priced(2.25)])),
        systemPrompt: undefined,
        toolInventory: undefined,
      });
    });
  });

  it("keeps Session.model 'unknown' when no turn usage was extracted", () => {
    const session = buildSession({
      sessionRow,
      turnRows,
      fileRows,
      mainJsonlAvailability: "missing",
    });

    expect(session.model).toBe("unknown");
  });
});
