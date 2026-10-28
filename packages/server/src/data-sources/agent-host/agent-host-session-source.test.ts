import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionSchema } from "@agent-cost-analyzer/domain";
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
import { AgentHostSessionSource } from "./agent-host-session-source.js";

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

  const source = () => new AgentHostSessionSource({ userDataDir });

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

    it("keeps a session whose session.db is missing, with its catalog title and unknown cost", async () => {
      writeAgentHostCatalog(userDataDir);

      const summary = (await source().listSessions()).find((session) => session.id === IDS.second)!;

      expect(summary.title).toBe("Add retry to uploader");
      expect(summary.turnCount).toBe(0);
      expect(summary.costAiCredits).toEqual({ known: false, reason: AGENT_HOST_SESSION_DB_MISSING_REASON });
    });

    it("never resolves a session.db outside agentSessionData for a catalog id that isn't a safe path segment", async () => {
      writeAgentHostCatalog(userDataDir, {
        sessions_v2: [{ ...catalogRows.sessions_v2[0], session_uri: "copilotcli:/../escape" }],
      });
      // A session.db where a path-traversing id would land.
      writeAgentSessionDbAt(path.join(userDataDir, "escape", "session.db"));

      const [summary] = await source().listSessions();

      expect(summary.id).toBe("../escape");
      expect(summary.turnCount).toBe(0);
      expect(summary.costAiCredits).toEqual({ known: false, reason: AGENT_HOST_SESSION_DB_MISSING_REASON });
    });

    it("degrades one unreadable session.db to unknown usage instead of failing the list", async () => {
      writeAgentHostCatalog(userDataDir);
      const dbPath = agentSessionDbPath(userDataDir, IDS.withTurns)!;
      mkdirSync(path.dirname(dbPath), { recursive: true });
      writeFileSync(dbPath, "not a database");

      const sessions = await source().listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions.find((session) => session.id === IDS.withTurns)!.costAiCredits).toEqual({
        known: false,
        reason: AGENT_HOST_SESSION_DB_MISSING_REASON,
      });
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

    it("has no round-trips for a turn that exists, since the Agent Host stores no request text", async () => {
      await expect(source().readTurnDetail(IDS.withTurns, 4)).resolves.toEqual({ turnIndex: 4, userMessage: [], rounds: [] });
    });
  });

  describe("lookupSystemPromptText", () => {
    it("is not-captured for a listed session and unknown-session otherwise", async () => {
      writeAgentHostCatalog(userDataDir);

      await expect(source().lookupSystemPromptText(IDS.withTurns)).resolves.toEqual({ status: "not-captured" });
      await expect(source().lookupSystemPromptText(IDS.deleted)).resolves.toEqual({ status: "unknown-session" });
    });

    it("is unknown-session without agent-host.db", async () => {
      await expect(source().lookupSystemPromptText(IDS.withTurns)).resolves.toEqual({ status: "unknown-session" });
    });
  });
});
