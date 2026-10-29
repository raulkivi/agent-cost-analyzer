import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionSchema, turnInspectorDetailSchema } from "@agent-cost-analyzer/domain";
import {
  COPILOT_CLI_FIXTURE_HOME,
  COPILOT_CLI_FIXTURE_SESSION_IDS as CLI,
  copilotCliFixtureRows,
  writeCopilotCliAgentHostStores,
} from "../../test-support/copilot-cli-fixtures.js";
import { TURN_EVENT_ALREADY_TAKEN_REASON } from "../../services/session-enricher/copilot-turn-segmenter.js";
import { copilotEventLogPath } from "./copilot-cli-paths.js";
import { CopilotEventLogCache, statEventLogFile, type CopilotEventLogLoad } from "./copilot-event-log-cache.js";
import { readCopilotEventLog } from "./copilot-event-log-reader.js";
import {
  AGENT_HOST_FIXTURE_SESSION_IDS as IDS,
  fixtureTurnNanoAiu,
  readAgentHostFixtureRows,
  sessionRowsWithUsageOnly,
  writeAgentHostCatalog,
  writeAgentSessionDb,
  writeAgentSessionDbAt,
} from "../../test-support/agent-host-user-data-dir.js";
import {
  AGENT_HOST_SESSION_COST_UNAVAILABLE_REASON,
  AGENT_HOST_SESSION_DB_MISSING_REASON,
} from "../../services/session-enricher/agent-host-session-builder.js";
import { agentSessionDbPath } from "./agent-host-paths.js";
import {
  AGENT_HOST_EVENT_LOG_MISSING_REASON,
  AGENT_HOST_EVENT_LOG_NO_HOME_REASON,
  AGENT_HOST_EVENT_LOG_UNREADABLE_REASON,
  AGENT_HOST_NO_SDK_SESSION_ID_REASON,
  AgentHostSessionSource,
  type AgentHostSessionSourceOptions,
} from "./agent-host-session-source.js";

const sessionRows = readAgentHostFixtureRows("session-rows.json");
const catalogRows = readAgentHostFixtureRows("catalog-rows.json");

describe("AgentHostSessionSource", () => {
  let userDataDir: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "agent-host-source-"));
  });
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  // The 10.13 tests' catalog has no chats_v2 rows, so no session finds a log.
  const source = (options: Partial<AgentHostSessionSourceOptions> = {}) =>
    new AgentHostSessionSource({ userDataDir, copilotHome: COPILOT_CLI_FIXTURE_HOME, ...options });

  describe("checkAvailability", () => {
    it("is available once agent-host.db exists, even when it was created after the source", async () => {
      const built = source();
      expect((await built.checkAvailability()).available).toBe(false);

      writeAgentHostCatalog(userDataDir);

      await expect(built.checkAvailability()).resolves.toEqual({ available: true });
    });

    it("gives a reason when there is no agent-host.db", async () => {
      const availability = await source().checkAvailability();

      expect(availability.available).toBe(false);
      expect(availability.unavailableReason).toMatch(/Agent Host/);
    });
  });

  describe("listSessions", () => {
    it("is empty without agent-host.db", async () => {
      await expect(source().listSessions()).resolves.toEqual([]);
    });

    it("lists the catalog's Copilot sessions newest first, skipping deleted and Claude sessions", async () => {
      writeAgentHostCatalog(userDataDir);
      writeAgentSessionDb(userDataDir, IDS.withTurns);
      writeAgentSessionDb(userDataDir, IDS.second);

      const sessions = await source().listSessions();

      expect(sessions.map((session) => session.id)).toEqual([IDS.second, IDS.withTurns]);
      for (const session of sessions) {
        expect(() => sessionSchema.parse(session)).not.toThrow();
        expect(session.turns).toEqual([]);
        expect(session.mode).toBe("analyze");
      }
    });

    it("summarizes a session from its session.db: title, model, turn count and AI Credits", async () => {
      writeAgentHostCatalog(userDataDir);
      writeAgentSessionDb(userDataDir, IDS.withTurns, sessionRowsWithUsageOnly());
      const expected = fixtureTurnNanoAiu(sessionRows).reduce((sum, nanoAiu) => sum + nanoAiu / 1e9, 0);

      const summary = (await source().listSessions()).find((session) => session.id === IDS.withTurns)!;

      expect(summary).toMatchObject({
        title: "Example custom title",
        model: "gpt-6-luna",
        turnCount: 4,
        startedAt: new Date(1790805037911).toISOString(),
        usageDataAvailable: true,
      });
      expect(summary.costAiCredits).toEqual({ known: true, value: expected });
    });

    it("leaves out a session whose session.db was read and has no turns (opened, never sent)", async () => {
      writeAgentHostCatalog(userDataDir);
      writeAgentSessionDb(userDataDir, IDS.withTurns, sessionRowsWithUsageOnly());
      writeAgentSessionDb(userDataDir, IDS.second, { ...sessionRows, turns: [] });

      expect((await source().listSessions()).map((session) => session.id)).toEqual([IDS.withTurns]);
    });

    it("keeps a session whose session.db is missing, with unknown usage and its reason", async () => {
      writeAgentHostCatalog(userDataDir);
      writeAgentSessionDb(userDataDir, IDS.withTurns, sessionRowsWithUsageOnly());

      const sessions = await source().listSessions();

      expect(sessions.map((session) => session.id)).toEqual([IDS.second, IDS.withTurns]);
      const missing = sessions.find((session) => session.id === IDS.second)!;
      expect(missing.costAiCredits).toEqual({ known: false, reason: AGENT_HOST_SESSION_DB_MISSING_REASON });
    });

    it("still reads a session without turns by id", async () => {
      writeAgentHostCatalog(userDataDir);

      const session = await source().readSession(IDS.second);

      expect(session?.title).toBe("Add retry to uploader");
      expect(session?.turnCount).toBe(0);
      expect(session?.costAiCredits).toEqual({ known: false, reason: AGENT_HOST_SESSION_DB_MISSING_REASON });
    });

    it("marks every listed session as an Agent Host session", async () => {
      writeAgentHostCatalog(userDataDir);
      writeAgentSessionDb(userDataDir, IDS.withTurns, sessionRowsWithUsageOnly());

      const sessions = await source().listSessions();

      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((session) => session.copilotHarness === "agent-host")).toBe(true);
    });

    it("never resolves a session.db outside agentSessionData for a catalog id that isn't a safe path segment", async () => {
      writeAgentHostCatalog(userDataDir, {
        sessions_v2: [{ ...catalogRows.sessions_v2[0], session_uri: "copilotcli:/../escape" }],
      });
      // A session.db where a path-traversing id would land.
      writeAgentSessionDbAt(path.join(userDataDir, "escape", "session.db"));

      const session = await source().readSession("../escape");

      expect(session?.id).toBe("../escape");
      expect(session?.turnCount).toBe(0);
      expect(session?.costAiCredits).toEqual({ known: false, reason: AGENT_HOST_SESSION_DB_MISSING_REASON });
    });

    it("degrades one unreadable session.db to unknown usage instead of failing the list", async () => {
      writeAgentHostCatalog(userDataDir);
      writeAgentSessionDb(userDataDir, IDS.second);
      const dbPath = agentSessionDbPath(userDataDir, IDS.withTurns)!;
      mkdirSync(path.dirname(dbPath), { recursive: true });
      writeFileSync(dbPath, "not a database");

      const sessions = await source().listSessions();

      expect(sessions.map((session) => session.id)).toEqual([IDS.second, IDS.withTurns]);
      const broken = sessions.find((session) => session.id === IDS.withTurns)!;
      expect(broken.costAiCredits).toEqual({ known: false, reason: AGENT_HOST_SESSION_DB_MISSING_REASON });
    });
  });

  describe("readSession", () => {
    beforeEach(() => {
      writeAgentHostCatalog(userDataDir);
      writeAgentSessionDb(userDataDir, IDS.withTurns);
    });

    it("returns null for an id the catalog doesn't list, a deleted session or a Claude session", async () => {
      for (const id of ["00000000-0000-4000-8000-000000000000", IDS.deleted, IDS.claude]) {
        await expect(source().readSession(id)).resolves.toBeNull();
      }
    });

    it("returns every turn with its tokens and AI Credits", async () => {
      const session = (await source().readSession(IDS.withTurns))!;

      expect(() => sessionSchema.parse(session)).not.toThrow();
      expect(session.turnCount).toBe(5);
      expect(session.turns).toHaveLength(5);
      const credits = session.turns.map((turn) => (turn.usage.costAiCredits.known ? turn.usage.costAiCredits.value : null));
      const [n1, n2, n4, n5] = fixtureTurnNanoAiu(sessionRows);
      expect(credits).toEqual([n1 / 1e9, n2 / 1e9, null, n4 / 1e9, n5 / 1e9]);
      // Turn 2 used two models: 9,899,296 + 59,601 input, 9,847,477 + 35,655 cached.
      expect(session.turns[1].usage.uncachedInput).toEqual({ known: true, value: 9_958_897 - 9_883_132 });
      expect(session.turns[1].usage.cacheRead).toEqual({ known: true, value: 9_883_132 });
      expect(session.turns[1].usage.output).toEqual({ known: true, value: 36_139 + 1_297 });
    });

    it("marks the event log missing when the catalog records no Copilot CLI session id", async () => {
      expect((await source().readSession(IDS.withTurns))!.copilotEventLog).toEqual({
        status: "missing",
        reason: AGENT_HOST_NO_SDK_SESSION_ID_REASON,
      });
    });

    it("makes the session total unknown when a turn has no usage record", async () => {
      const session = (await source().readSession(IDS.withTurns))!;

      expect(session.costAiCredits).toEqual({ known: false, reason: AGENT_HOST_SESSION_COST_UNAVAILABLE_REASON });
    });
  });

  describe("readTurnDetail", () => {
    beforeEach(() => {
      writeAgentHostCatalog(userDataDir);
      writeAgentSessionDb(userDataDir, IDS.withTurns);
    });

    it("is null for an unknown session or a turn index the session doesn't have", async () => {
      await expect(source().readTurnDetail(IDS.deleted, 0)).resolves.toBeNull();
      await expect(source().readTurnDetail(IDS.withTurns, 5)).resolves.toBeNull();
      await expect(source().readTurnDetail(IDS.withTurns, -1)).resolves.toBeNull();
      await expect(source().readTurnDetail(IDS.second, 0)).resolves.toBeNull();
    });

    it("has unknown rounds, with the reason, for a turn of a session without a Copilot CLI session id", async () => {
      await expect(source().readTurnDetail(IDS.withTurns, 4)).resolves.toEqual({
        turnIndex: 4,
        userMessage: [],
        rounds: [],
        unavailableReason: AGENT_HOST_NO_SDK_SESSION_ID_REASON,
      });
    });
  });

  describe("lookupSystemPromptText", () => {
    it("is not-captured for a listed session without a log and unknown-session otherwise", async () => {
      writeAgentHostCatalog(userDataDir);

      await expect(source().lookupSystemPromptText(IDS.withTurns)).resolves.toEqual({ status: "not-captured" });
      await expect(source().lookupSystemPromptText(IDS.deleted)).resolves.toEqual({ status: "unknown-session" });
    });

    it("is unknown-session without agent-host.db", async () => {
      await expect(source().lookupSystemPromptText(IDS.withTurns)).resolves.toEqual({ status: "unknown-session" });
    });
  });
  describe("with the Copilot CLI event log (step 10.14)", () => {
    beforeEach(() => {
      writeCopilotCliAgentHostStores(userDataDir);
    });

    const spyLoader = () => ({ load: vi.fn(async (): Promise<CopilotEventLogLoad> => ({ status: "missing" })) });

    it("opens no event log while listing sessions", async () => {
      const eventLogs = spyLoader();

      const sessions = await source({ eventLogs }).listSessions();

      expect(sessions.length).toBe(5);
      expect(eventLogs.load).not.toHaveBeenCalled();
      expect(sessions.every((session) => session.copilotEventLog === undefined)).toBe(true);
    });

    it("reads a session's turn text, tool calls and system prompt from its log", async () => {
      const session = (await source().readSession(CLI.normal))!;

      expect(() => sessionSchema.parse(session)).not.toThrow();
      expect(session.copilotEventLog).toEqual({ status: "read" });
      expect(session.turns[0]!.userMessage).toBe("Example prompt one: please list the source files.");
      expect(session.turns.flatMap((turn) => turn.toolCalls).length).toBeGreaterThan(0);
      expect(session.systemPrompt?.map((component) => component.kind)).toEqual(["built-in", "tool-definitions"]);
      expect(session.costAiCredits.known).toBe(true);
    });

    it("keeps an unmatched turn unknown with the segmenter's reason", async () => {
      const session = (await source().readSession(CLI.steeringAbortSubagent))!;

      expect(session.copilotEventLog).toEqual({ status: "read" });
      expect(session.turns[4]!.toolCallsUnavailableReason).toBe(TURN_EVENT_ALREADY_TAKEN_REASON);
    });

    it("marks a session whose log is missing, keeping its tokens and AI Credits", async () => {
      const session = (await source().readSession(CLI.missingLog))!;

      expect(session.copilotEventLog).toEqual({ status: "missing", reason: AGENT_HOST_EVENT_LOG_MISSING_REASON });
      expect(session.turns.map((turn) => turn.userMessage)).toEqual(["", ""]);
      expect(session.costAiCredits.known).toBe(true);
    });

    it("reads no log without a Copilot home", async () => {
      const eventLogs = spyLoader();

      const session = (await source({ copilotHome: null, eventLogs }).readSession(CLI.normal))!;

      expect(session.copilotEventLog).toEqual({ status: "missing", reason: AGENT_HOST_EVENT_LOG_NO_HOME_REASON });
      expect(eventLogs.load).not.toHaveBeenCalled();
    });

    it("degrades an unreadable log to unknown with the reason instead of rejecting", async () => {
      const copilotHome = mkdtempSync(path.join(tmpdir(), "copilot-home-"));
      try {
        // A directory where events.jsonl should be: the reader rejects (EISDIR).
        mkdirSync(copilotEventLogPath(copilotHome, copilotCliFixtureRows.sdkSessionIds.normal)!, { recursive: true });

        const session = (await source({ copilotHome }).readSession(CLI.normal))!;

        expect(session.copilotEventLog?.status).toBe("unreadable");
        expect(session.copilotEventLog).toMatchObject({ reason: expect.stringContaining(AGENT_HOST_EVENT_LOG_UNREADABLE_REASON) });
        expect(session.turns).toHaveLength(2);
      } finally {
        rmSync(copilotHome, { recursive: true, force: true });
      }
    });

    it("degrades a loader that rejects, too", async () => {
      const eventLogs = { load: vi.fn(async (): Promise<CopilotEventLogLoad> => Promise.reject(new Error("boom"))) };

      const session = (await source({ eventLogs }).readSession(CLI.normal))!;

      expect(session.copilotEventLog?.status).toBe("unreadable");
    });

    it("parses a log once across reads while it is unchanged", async () => {
      const read = vi.fn((filePath: string) => readCopilotEventLog(filePath));
      const built = source({ eventLogs: new CopilotEventLogCache({ read, stat: statEventLogFile }) });

      await built.readSession(CLI.normal);
      await built.readTurnDetail(CLI.normal, 0);
      await built.lookupSystemPromptText(CLI.normal);

      expect(read).toHaveBeenCalledTimes(1);
    });

    it("re-parses a log that grew since it was read", async () => {
      const copilotHome = mkdtempSync(path.join(tmpdir(), "copilot-home-"));
      try {
        cpSync(COPILOT_CLI_FIXTURE_HOME, copilotHome, { recursive: true });
        const read = vi.fn((filePath: string) => readCopilotEventLog(filePath));
        const built = source({ copilotHome, eventLogs: new CopilotEventLogCache({ read, stat: statEventLogFile }) });

        await built.readSession(CLI.normal);
        writeFileSync(copilotEventLogPath(copilotHome, copilotCliFixtureRows.sdkSessionIds.normal)!, "\n", { flag: "a" });
        await built.readSession(CLI.normal);

        expect(read).toHaveBeenCalledTimes(2);
      } finally {
        rmSync(copilotHome, { recursive: true, force: true });
      }
    });

    describe("readTurnDetail", () => {
      it("gives a matched turn's rounds", async () => {
        const detail = (await source().readTurnDetail(CLI.normal, 0))!;

        expect(() => turnInspectorDetailSchema.parse(detail)).not.toThrow();
        expect(detail.rounds.length).toBeGreaterThan(0);
        expect(detail.unavailableReason).toBeUndefined();
      });

      it("gives an unmatched turn, or a turn of a session without a log, unknown rounds with the reason", async () => {
        await expect(source().readTurnDetail(CLI.steeringAbortSubagent, 4)).resolves.toMatchObject({
          rounds: [],
          unavailableReason: TURN_EVENT_ALREADY_TAKEN_REASON,
        });
        await expect(source().readTurnDetail(CLI.missingLog, 1)).resolves.toMatchObject({
          rounds: [],
          unavailableReason: AGENT_HOST_EVENT_LOG_MISSING_REASON,
        });
      });

      it("is null for a turn index the session.db doesn't have, without opening the log", async () => {
        const eventLogs = spyLoader();

        await expect(source({ eventLogs }).readTurnDetail(CLI.normal, 2)).resolves.toBeNull();
        expect(eventLogs.load).not.toHaveBeenCalled();
      });
    });

    describe("lookupSystemPromptText", () => {
      it("finds the latest main-agent system prompt", async () => {
        const lookup = await source().lookupSystemPromptText(CLI.normal);

        expect(lookup.status).toBe("found");
        expect(lookup.status === "found" && lookup.text).toMatch(/^You are a coding agent/);
      });

      it("is not-captured when the log is missing or unreadable", async () => {
        await expect(source().lookupSystemPromptText(CLI.missingLog)).resolves.toEqual({ status: "not-captured" });
        const eventLogs = { load: vi.fn(async (): Promise<CopilotEventLogLoad> => ({ status: "unreadable", error: new Error("x") })) };
        await expect(source({ eventLogs }).lookupSystemPromptText(CLI.normal)).resolves.toEqual({ status: "not-captured" });
      });
    });
  });
});
