// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { chmodSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Session } from "@agent-cost-analyzer/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedSubagentFixtureSession } from "../../../test-support/copilot-session-store.js";
import {
  SUBAGENT_FOLDER_UNREADABLE_REASON,
  SUBAGENT_LOG_MISSING_REASON,
  SUBAGENT_LOG_NAME_REJECTED_REASON,
  SUBAGENT_LOG_NOT_REGULAR_FILE_REASON,
  SUBAGENT_LOG_READ_FAILED_REASON,
  SUBAGENT_LOGS_TOO_MANY_REASON,
  SUBAGENT_REF_BEFORE_FIRST_TURN_REASON,
  SUBAGENT_RUN_UNPLACEABLE_REASON,
} from "../../jsonl/subagent-attribution.js";
import { NESTED_SUBAGENTS_REASON } from "../../jsonl/subagent-run-usage.js";
import { AI_CREDITS_NOT_AVAILABLE_REASON } from "../../jsonl/session-usage-spans.js";
import { VscodeLogProvider } from "./vscode-log-provider.js";

// Step 10.19 SA9: the classic reader folds subagent runs into the list and the
// detail through one reader, so both report the same session.
describe("VscodeLogProvider: classic subagent runs in the list and in the detail", () => {
  let dir: string;
  let dbPath: string;
  let debugLogsDir: string;
  let agentTracesDbPath: string | null;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vscode-log-provider-subagents-"));
    dbPath = path.join(dir, "session-store.db");
    debugLogsDir = path.join(dir, "debug-logs");
    agentTracesDbPath = null;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const provider = () =>
    new VscodeLogProvider({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDir], agentTracesDbPath });
  const sessionDir = (id: string) => path.join(debugLogsDir, id);

  async function listAndRead(id: string): Promise<{ listed: Session; detail: Session }> {
    const listed = (await provider().listSessions()).find((session) => session.id === id);
    const detail = await provider().readSession(id);
    expect(listed).toBeDefined();
    expect(detail).not.toBeNull();
    return { listed: listed!, detail: detail! };
  }

  const figures = (session: Session) => ({
    costAiCredits: session.costAiCredits,
    subagentSpend: session.subagentSpend,
    turnCount: session.turnCount,
    model: session.model,
    usageDataAvailable: session.usageDataAvailable,
  });

  describe("a session whose runs are all read and placed", () => {
    it("adds the runs' AI Credits to the turns that started them, the same in the list and in the detail", async () => {
      seedSubagentFixtureSession(dbPath, debugLogsDir, "run-and-search");

      const { listed, detail } = await listAndRead("run-and-search");

      // 2 + 2 of the main agent, 1.1 of the run, 0 of the search.
      expect(listed.costAiCredits).toEqual({ known: true, value: expect.closeTo(5.1, 9) });
      expect(figures(listed)).toEqual(figures(detail));
      expect(listed.subagentSpend).toEqual({ runs: 2, costAiCredits: { known: true, value: expect.closeTo(1.1, 9) } });
      expect(detail.turns.map((turn) => turn.usage.subagents?.map((run) => run.id))).toEqual([["call_fixturerun1"], ["call_fixturesearch1"]]);
      expect(detail.turns[0].usage.costAiCredits).toEqual({ known: true, value: expect.closeTo(3.1, 9) });
      expect(detail.turns[0].usage.ownUsage?.costAiCredits).toEqual({ known: true, value: 2 });
    });

    it("places a run no ref names by its start time (orphan)", async () => {
      seedSubagentFixtureSession(dbPath, debugLogsDir, "orphan-by-time");

      const { listed, detail } = await listAndRead("orphan-by-time");

      expect(listed.costAiCredits.known).toBe(true);
      expect(figures(listed)).toEqual(figures(detail));
      expect(listed.subagentSpend?.runs).toBe(1);
      expect(detail.turns.flatMap((turn) => turn.usage.subagents ?? []).map((run) => run.attribution)).toEqual(["timestamp"]);
    });

    it("tolerates a partial last line in a run's log", async () => {
      seedSubagentFixtureSession(dbPath, debugLogsDir, "partial-last-line");

      const { listed, detail } = await listAndRead("partial-last-line");

      expect(listed.costAiCredits.known).toBe(true);
      expect(figures(listed)).toEqual(figures(detail));
    });

    it("leaves a session with no subagent files as it was, without subagentSpend", async () => {
      seedSubagentFixtureSession(dbPath, debugLogsDir, "orphan-by-time");
      unlinkSync(path.join(sessionDir("orphan-by-time"), "runSubagent-Plan-call_fixtureorphan1.jsonl"));

      const { listed, detail } = await listAndRead("orphan-by-time");

      expect(listed.subagentSpend).toBeUndefined();
      expect(figures(listed)).toEqual(figures(detail));
    });
  });

  // Every reason a run can be unknown makes the session's AI Credits unknown,
  // with that reason, in the list and in the detail (constraint 6).
  describe.each([
    ["dangling ref", "dangling-ref", SUBAGENT_LOG_MISSING_REASON],
    ["a ref whose name is not a subagent log", "traversal-ref", SUBAGENT_LOG_NAME_REJECTED_REASON],
    ["a nested ref", "nested-ref", NESTED_SUBAGENTS_REASON],
    ["a request without AI Credits", "request-without-credits", AI_CREDITS_NOT_AVAILABLE_REASON],
    ["an orphan that cannot be placed", "orphan-unplaceable", SUBAGENT_RUN_UNPLACEABLE_REASON],
    ["a ref before the first turn", "ref-before-first-turn", SUBAGENT_REF_BEFORE_FIRST_TURN_REASON],
  ])("%s", (_label, caseName, reason) => {
    it("makes the session's AI Credits unknown with that reason, equally in the list and in the detail", async () => {
      seedSubagentFixtureSession(dbPath, debugLogsDir, caseName);

      const { listed, detail } = await listAndRead(caseName);

      expect(listed.costAiCredits).toEqual({ known: false, reason });
      expect(figures(listed)).toEqual(figures(detail));
    });
  });

  it("makes the session unknown when a run's log is not a regular file", async () => {
    seedSubagentFixtureSession(dbPath, debugLogsDir, "run-and-search");
    const run = path.join(sessionDir("run-and-search"), "runSubagent-Explore-call_fixturerun1.jsonl");
    unlinkSync(run);
    symlinkSync(path.join(sessionDir("run-and-search"), "searchSubagent-call_fixturesearch1.jsonl"), run);

    const { listed, detail } = await listAndRead("run-and-search");

    expect(listed.costAiCredits).toEqual({ known: false, reason: SUBAGENT_LOG_NOT_REGULAR_FILE_REASON });
    expect(figures(listed)).toEqual(figures(detail));
  });

  it("makes the session unknown when a run's log cannot be read", async () => {
    seedSubagentFixtureSession(dbPath, debugLogsDir, "run-and-search");
    const run = path.join(sessionDir("run-and-search"), "runSubagent-Explore-call_fixturerun1.jsonl");
    chmodSync(run, 0o000);

    const { listed, detail } = await listAndRead("run-and-search");

    expect(listed.costAiCredits).toEqual({ known: false, reason: SUBAGENT_LOG_READ_FAILED_REASON });
    expect(figures(listed)).toEqual(figures(detail));
  });

  it("makes the session unknown when its folder cannot be listed", async () => {
    seedSubagentFixtureSession(dbPath, debugLogsDir, "run-and-search");
    const folder = sessionDir("run-and-search");
    chmodSync(folder, 0o300); // search and write, no read: files open by name, the listing fails
    try {
      const { listed, detail } = await listAndRead("run-and-search");

      expect(listed.costAiCredits).toEqual({ known: false, reason: SUBAGENT_FOLDER_UNREADABLE_REASON });
      expect(figures(listed)).toEqual(figures(detail));
    } finally {
      chmodSync(folder, 0o700);
    }
  });

  it("makes the session unknown, reading no subagent log, when the folder has too many", async () => {
    seedSubagentFixtureSession(dbPath, debugLogsDir, "run-and-search");
    for (let index = 0; index < 201; index++) {
      writeFileSync(path.join(sessionDir("run-and-search"), `runSubagent-Many-call_${index}.jsonl`), "");
    }

    const { listed, detail } = await listAndRead("run-and-search");

    expect(listed.costAiCredits).toEqual({ known: false, reason: SUBAGENT_LOGS_TOO_MANY_REASON });
    expect(figures(listed)).toEqual(figures(detail));
  });

  describe("cacheWrite and reasoning (agent-traces.db, the detail only)", () => {
    function writeAgentTraces(rows: [responseId: string, cacheWrite: number, reasoning: number][]): string {
      const tracesPath = path.join(dir, "agent-traces.db");
      const db = new DatabaseSync(tracesPath);
      db.exec(`
        CREATE TABLE spans (span_id TEXT PRIMARY KEY, operation_name TEXT, reasoning_tokens INTEGER);
        CREATE TABLE span_attributes (span_id TEXT, key TEXT, value TEXT);
      `);
      rows.forEach(([responseId, cacheWrite, reasoning], index) => {
        db.prepare("INSERT INTO spans VALUES (?, 'chat', ?)").run(`span-${index}`, reasoning);
        db.prepare("INSERT INTO span_attributes VALUES (?, 'gen_ai.response.id', ?)").run(`span-${index}`, responseId);
        db.prepare("INSERT INTO span_attributes VALUES (?, 'gen_ai.usage.cache_creation.input_tokens', ?)").run(`span-${index}`, String(cacheWrite));
      });
      db.close();
      return tracesPath;
    }

    it("joins a run's responseIds in the detail, and keeps them unknown in the list", async () => {
      seedSubagentFixtureSession(dbPath, debugLogsDir, "run-and-search");
      agentTracesDbPath = writeAgentTraces([
        ["resp-main-1", 100, 10],
        ["resp-main-2", 200, 20],
        ["resp-call_fixturerun1", 7, 1],
      ]);

      const { listed, detail } = await listAndRead("run-and-search");

      // Turn 0: the main request, plus the run's two requests (one responseId, counted per request).
      expect(detail.turns[0].usage.cacheWrite).toEqual({ known: true, value: 114 });
      expect(detail.turns[0].usage.reasoning).toEqual({ known: true, value: 12 });
      expect(detail.turns[0].usage.subagents?.[0].cacheWrite).toEqual({ known: true, value: 14 });
      // Turn 1: the search run's request has no responseId, so the turn's sums stay unknown.
      expect(detail.turns[1].usage.cacheWrite.known).toBe(false);
      // The list neither opens agent-traces.db nor knows more AI Credits or tokens.
      expect(listed.costAiCredits).toEqual(detail.costAiCredits);
    });

    it("leaves a run's cacheWrite unknown in the detail when no agent-traces.db is configured", async () => {
      seedSubagentFixtureSession(dbPath, debugLogsDir, "run-and-search");

      const { detail } = await listAndRead("run-and-search");

      expect(detail.turns[0].usage.subagents?.[0].cacheWrite.known).toBe(false);
      expect(detail.turns[0].usage.cacheWrite.known).toBe(false);
    });
  });
});
