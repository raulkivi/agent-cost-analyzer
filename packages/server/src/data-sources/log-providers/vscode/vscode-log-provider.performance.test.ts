// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedSubagentFixtureSession } from "../../../test-support/copilot-session-store.js";
import { VscodeLogProvider } from "./vscode-log-provider.js";

// Plan §3.5 (step 10.19): reading subagent logs must not make the Sessions
// view's list slow. 200 classic sessions, a tenth of them with a subagent run
// and a search, all listed (one main.jsonl read per session, plus the runs').
const SESSION_COUNT = 200;
const SESSIONS_WITH_RUNS_SHARE = 0.1;
const LIST_BUDGET_MS = 1_000;
const ATTEMPTS = 3;

describe("VscodeLogProvider.listSessions with subagent runs in a tenth of 200 sessions", () => {
  let dir: string;
  let provider: VscodeLogProvider;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vscode-log-provider-performance-"));
    const dbPath = path.join(dir, "session-store.db");
    const debugLogsDir = path.join(dir, "debug-logs");
    const withRuns = SESSION_COUNT * SESSIONS_WITH_RUNS_SHARE;
    for (let index = 0; index < SESSION_COUNT; index++) {
      const id = `perf-session-${index}`;
      if (index < withRuns) {
        seedSubagentFixtureSession(dbPath, debugLogsDir, "run-and-search", "2026-09-21T10:00:00.000Z", id);
        continue;
      }
      // The rest: a main.jsonl and no subagent file, as most real sessions.
      seedSubagentFixtureSession(dbPath, debugLogsDir, "orphan-by-time", "2026-09-21T10:00:00.000Z", id);
      for (const file of readdirSync(path.join(debugLogsDir, id)).filter((name) => name.includes("Subagent-"))) {
        rmSync(path.join(debugLogsDir, id, file));
      }
    }
    provider = new VscodeLogProvider({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDir], agentTracesDbPath: null });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Best of a few attempts, so a busy CI machine's one slow run is not a failure.
  it(`lists all of them within ${LIST_BUDGET_MS} ms (best of ${ATTEMPTS})`, async () => {
    const durations: number[] = [];
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const start = performance.now();
      const sessions = await provider.listSessions();
      durations.push(performance.now() - start);
      expect(sessions).toHaveLength(SESSION_COUNT);
    }
    console.info(`listSessions over ${SESSION_COUNT} sessions: ${durations.map((ms) => ms.toFixed(0)).join(", ")} ms`);

    expect(Math.min(...durations)).toBeLessThan(LIST_BUDGET_MS);
  });

  it("still reads the runs of the tenth of sessions that have them", async () => {
    const sessions = await provider.listSessions();

    const withRuns = sessions.filter((session) => session.subagentSpend !== undefined);
    expect(withRuns).toHaveLength(SESSION_COUNT * SESSIONS_WITH_RUNS_SHARE);
    expect(withRuns.every((session) => session.subagentSpend?.runs === 2 && session.costAiCredits.known)).toBe(true);
    expect(sessions.filter((session) => session.costAiCredits.known)).toHaveLength(SESSION_COUNT);
  });
});
