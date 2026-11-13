// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Step 10.19 SA18: real-data check of the classic-subagent AI Credits against
// this machine's own Copilot Chat logs. Opt-in and local only:
//
//   npm run test:real-data --workspace=packages/server
//   REAL_DATA_USER_DATA="<dir>,<dir>" ...   (default ~/.config/Code and "~/.config/Code - Insiders")
//
// Expected figures come from the SA0 measurement (subagent-spend-lib.mts, which
// reads the raw logs and shares no code with the server); actual figures come
// from the server composed as the extension composes it, over the same dirs.
// Output and assertions carry session ids, dates, sums, counts and model names
// only: never prompts, responses, titles, file contents or paths. Read-only.
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { costRollupSchema, sessionCostSchema, type Session, type SessionCost, type TokenCount } from "@agent-cost-analyzer/domain";
import { createCopilotMcpServices } from "../src/composition/create-copilot-mcp-services.js";
import { createExtensionApiService } from "../src/composition/create-extension-api-service.js";
import { listWorkspaceDebugLogsDirPaths } from "../src/data-sources/jsonl/session-log-path.js";
import { copilotChatGlobalStoragePath } from "../src/data-sources/sqlite/copilot-chat-global-storage-path.js";
import { createMcpServer } from "../src/mcp/mcp-server.js";
import type { ApiService } from "../src/services/api/api-service.js";
import { InMemoryAppSettingsStore } from "../src/test-support/in-memory-app-settings-store.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../src/test-support/vendor-profiles-dir.js";
import { aggregateSessions } from "./subagent-spend-lib.mjs";
import { type MeasuredSession, measureUserDataDirs } from "./subagent-spend-scan.mjs";

const TOLERANCE = 0.01;
const ROLLUP_SINCE = "2026-08-01";
const ROLLUP_UNTIL = "2026-10-01";
// get_cost_rollup reads at most this many recent sessions per provider.
const MAX_ROLLUP_SESSIONS = 500;

const REAL_DATA = process.env.REAL_DATA === "1";
const defaultDirs = [path.join(homedir(), ".config", "Code"), path.join(homedir(), ".config", "Code - Insiders")];
const userDataDirs = (process.env.REAL_DATA_USER_DATA?.split(",").map((d) => d.trim()).filter(Boolean) ?? defaultDirs).filter((d) => {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
});

// Skipped, with the reason in the test names, unless opted in and logs exist.
const skipReason = !REAL_DATA ? "set REAL_DATA=1 to run" : userDataDirs.length === 0 ? "no VS Code user-data dir found (REAL_DATA_USER_DATA)" : null;

const near = (actual: number, expected: number, tolerance = TOLERANCE) => Math.abs(actual - expected) <= tolerance;
const f = (n: number) => n.toFixed(2);
// An unknown figure (known: false) becomes NaN, which fails every comparison.
const credits = (c: TokenCount | undefined): number => (c?.known ? c.value : NaN);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

interface Edition {
  userData: string;
  name: string;
  api: ApiService;
  mcp: Client;
}

// The extension's own derivation of every path from VS Code's user-data dir
// (packages/vscode-extension/src/platform/copilot-log-paths.ts), over the
// server's resolvers: the server package can't import the extension.
function composeEdition(userData: string) {
  const paths = {
    sessionStoreDbPath: copilotChatGlobalStoragePath(userData, "session-store.db"),
    debugLogsDirPaths: listWorkspaceDebugLogsDirPaths({ userDataDir: userData }),
    agentTracesDbPath: copilotChatGlobalStoragePath(userData, "agent-traces.db"),
    agentHostUserDataDir: userData,
    copilotHome: null,
  };
  const api = createExtensionApiService({
    ...paths,
    vscodeSettingsPath: null,
    appSettings: new InMemoryAppSettingsStore(),
    learnScriptsDir: path.join(FIXTURE_VENDOR_PROFILES_DIR, "..", "learn-scripts"),
    vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR,
    appVersion: "0.0.0-real-data",
  });
  const server = createMcpServer(createCopilotMcpServices({ ...paths, appVersion: "0.0.0-real-data", vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR }));
  return { api, server };
}

// Names, sizes and mtimes of the given sessions' log folders: a read-only run
// leaves them unchanged. Not the whole debug-logs tree: a running VS Code keeps
// writing the live session's files, which would make that a false alarm.
function fingerprint(userData: string, sessionIds: string[]): string {
  const out: string[] = [];
  for (const root of listWorkspaceDebugLogsDirPaths({ userDataDir: userData })) {
    for (const id of sessionIds) {
      const dir = path.join(root, id);
      let names: string[];
      try {
        names = readdirSync(dir).sort();
      } catch {
        continue;
      }
      for (const n of names) {
        const s = statSync(path.join(dir, n));
        out.push(`${id}/${n}|${s.size}|${s.mtimeMs}`);
      }
    }
  }
  return out.join("\n");
}

// describe.skip keeps the reason visible in `npm test` output.
(skipReason === null ? describe : describe.skip)(`SA18 real-data subagent credits${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  const editions = new Map<string, Edition>();
  const fingerprintsBefore = new Map<string, string>();
  let measured: MeasuredSession[] = [];
  const listed: { edition: string; session: Session }[] = [];

  const subagentSessionIds = (edition: string) => measured.filter((r) => r.edition === edition && r.summary.files > 0).map((r) => r.sessionId);
  const editionOf = (row: MeasuredSession) => editions.get(row.edition)!;
  const isListed = (r: MeasuredSession) => listed.some((l) => l.edition === r.edition && l.session.id === r.sessionId);
  const allWithSubagentFiles = () => measured.filter((r) => r.summary.files > 0);
  // The server lists only sessions with a session-store.db row, so a
  // main.jsonl without one is invisible to every tool; those are reported by
  // the coverage test below, not compared.
  const withSubagentFiles = () => allWithSubagentFiles().filter(isListed).sort((a, b) => (a.summary.startDate ?? "").localeCompare(b.summary.startDate ?? ""));
  const sessionCost = async (row: MeasuredSession): Promise<SessionCost> => {
    const result = await editionOf(row).mcp.callTool({ name: "get_session_cost", arguments: { sessionId: row.sessionId, topTurns: 1 } });
    expect(result.isError, `get_session_cost ${row.sessionId}: ${JSON.stringify(result.content).slice(0, 200)}`).toBeFalsy();
    return sessionCostSchema.parse(result.structuredContent);
  };

  beforeAll(async () => {
    measured = measureUserDataDirs(userDataDirs).rows;
    for (const userData of userDataDirs) {
      const name = path.basename(userData);
      fingerprintsBefore.set(name, fingerprint(userData, subagentSessionIds(name)));
      const { api, server } = composeEdition(userData);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const mcp = new Client({ name: "sa18-real-data", version: "1.0.0" });
      await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
      editions.set(name, { userData, name, api, mcp });
      listed.push(...(await api.listSessions()).map((session) => ({ edition: name, session })));
    }
  }, 300_000);

  afterAll(async () => {
    for (const e of editions.values()) await e.mcp.close();
  });

  it("measures the SA0 baseline: sessions, sessions with subagent files, grand total missing", () => {
    const totals = aggregateSessions(measured.map((r) => r.summary));
    console.log(`SA0 oracle: sessions=${totals.sessions} withSubagentFiles=${totals.sessionsWithSubagentFiles} missing=${f(totals.missingAiCredits)} counted=${f(totals.mainAiCredits)}`);
    expect(totals.sessionsWithSubagentFiles, "no session with subagent files on this machine: nothing to check").toBeGreaterThan(0);
  });

  it("lists every session with subagent credits (an unlisted one may only miss 0.00)", () => {
    const unlisted = allWithSubagentFiles().filter((r) => !isListed(r));
    console.log(`subagent sessions: oracle=${allWithSubagentFiles().length} listedByServer=${withSubagentFiles().length}`);
    for (const r of unlisted) console.log(`${r.sessionId} ${r.summary.startDate} not listed by the server: counted=${f(r.summary.mainAiCredits)} missing=${f(r.summary.missingAiCredits)}`);
    expect(unlisted.filter((r) => !near(r.summary.missingAiCredits, 0)).map((r) => r.sessionId)).toEqual([]);
  });

  it("list summary AI Credits == detail AI Credits == counted + missing, per session", async () => {
    const problems: string[] = [];
    for (const row of withSubagentFiles()) {
      const { api } = editionOf(row);
      const summary = (await api.listSessions()).find((s) => s.id === row.sessionId);
      const detail = await api.getSession(row.sessionId);
      const expected = row.summary.mainAiCredits + row.summary.missingAiCredits;
      console.log(`${row.sessionId} ${row.summary.startDate} counted=${f(row.summary.mainAiCredits)} missing=${f(row.summary.missingAiCredits)} list=${f(credits(summary?.costAiCredits))} detail=${f(credits(detail.costAiCredits))}`);
      if (!near(credits(summary?.costAiCredits), expected)) problems.push(`${row.sessionId} list ${f(credits(summary?.costAiCredits))} != ${f(expected)}`);
      if (!near(credits(detail.costAiCredits), expected)) problems.push(`${row.sessionId} detail ${f(credits(detail.costAiCredits))} != ${f(expected)}`);
    }
    expect(problems).toEqual([]);
  }, 300_000);

  it("get_session_cost total equals counted + missing and its subagents total equals missing", async () => {
    const problems: string[] = [];
    for (const row of withSubagentFiles()) {
      const cost = await sessionCost(row);
      const expected = row.summary.mainAiCredits + row.summary.missingAiCredits;
      const total = cost.totals.aiCredits.value;
      const subagents = cost.subagents?.aiCredits ?? null;
      console.log(`${row.sessionId} mcp total=${total === null ? "null" : f(total)} subagents=${subagents === null ? "null" : f(subagents)} runs=${cost.subagents?.runs} files=${row.summary.files}`);
      if (total === null || !near(total, expected)) problems.push(`${row.sessionId} total ${total} != ${f(expected)}`);
      if (subagents === null || !near(subagents, row.summary.missingAiCredits)) problems.push(`${row.sessionId} subagents ${subagents} != ${f(row.summary.missingAiCredits)}`);
      if (cost.subagents?.runs !== row.summary.files) problems.push(`${row.sessionId} runs ${cost.subagents?.runs} != files ${row.summary.files}`);
    }
    expect(problems).toEqual([]);
  }, 300_000);

  it("searchSubagent-only sessions miss 0.00 and total equals counted", async () => {
    const searchOnly = withSubagentFiles().filter((r) => r.summary.runsByKind.runSubagent === 0);
    expect(searchOnly.length, "expected searchSubagent-only sessions on this machine").toBeGreaterThan(0);
    const problems: string[] = [];
    for (const row of searchOnly) {
      const cost = await sessionCost(row);
      const total = cost.totals.aiCredits.value;
      console.log(`${row.sessionId} searchOnly missing=${f(row.summary.missingAiCredits)} counted=${f(row.summary.mainAiCredits)} mcp total=${total === null ? "null" : f(total)} subagents=${cost.subagents?.aiCredits === null || cost.subagents === undefined ? "none" : f(cost.subagents.aiCredits)}`);
      if (!near(row.summary.missingAiCredits, 0)) problems.push(`${row.sessionId} oracle missing ${f(row.summary.missingAiCredits)} != 0`);
      if (total === null || !near(total, row.summary.mainAiCredits)) problems.push(`${row.sessionId} total ${total} != counted ${f(row.summary.mainAiCredits)}`);
      if (cost.subagents?.aiCredits != null && !near(cost.subagents.aiCredits, 0)) problems.push(`${row.sessionId} subagents ${cost.subagents.aiCredits} != 0`);
    }
    expect(problems).toEqual([]);
  }, 300_000);

  it("never double counts: total minus the subagent share equals the counted credits", async () => {
    const problems: string[] = [];
    for (const row of withSubagentFiles()) {
      const cost = await sessionCost(row);
      const total = cost.totals.aiCredits.value;
      const share = cost.subagents?.aiCredits ?? 0;
      if (total === null || !near(total - share, row.summary.mainAiCredits)) problems.push(`${row.sessionId} total-share ${total === null ? "null" : f(total - share)} != counted ${f(row.summary.mainAiCredits)}`);
    }
    expect(problems).toEqual([]);
  }, 300_000);

  it("per-model figures sum to the total and credit the subagent runs' models", async () => {
    const problems: string[] = [];
    for (const row of withSubagentFiles()) {
      const cost = await sessionCost(row);
      const total = cost.totals.aiCredits.value ?? NaN;
      const byModel = new Map(cost.byModel.map((m) => [m.model, m.aiCredits ?? 0]));
      const modelSum = sum([...byModel.values()]);
      console.log(`${row.sessionId} models=${[...byModel.entries()].map(([m, c]) => `${m}:${f(c)}`).join(",")} subagentModels=${Object.entries(row.summary.subagentAiCreditsByModel).map(([m, c]) => `${m}:${f(c)}`).join(",")}`);
      if (!near(modelSum, total)) problems.push(`${row.sessionId} per-model sum ${f(modelSum)} != total ${f(total)}`);
      for (const [model, credits] of Object.entries(row.summary.subagentAiCreditsByModel)) {
        const credited = byModel.get(model) ?? 0;
        if (credited + TOLERANCE < credits) problems.push(`${row.sessionId} ${model} credited ${f(credited)} < subagent ${f(credits)}`);
      }
    }
    expect(problems).toEqual([]);
  }, 300_000);

  // A list summary is unknown when any turn's credits are (constraint 6), while
  // the rollup sums the turns it knows with coverage. So a list-unknown session
  // contributes its known turns' sum, which get_session_cost reports.
  it(`get_cost_rollup ${ROLLUP_SINCE}..${ROLLUP_UNTIL} equals the sum of the session totals in that range`, async () => {
    let expected = 0;
    let rollupTotal = 0;
    let sessionsInRange = 0;
    let partialSessions = 0;
    for (const e of editions.values()) {
      const inRange = listed.filter((l) => l.edition === e.name && l.session.startedAt !== undefined && l.session.startedAt.slice(0, 10) >= ROLLUP_SINCE && l.session.startedAt.slice(0, 10) <= ROLLUP_UNTIL);
      expect(inRange.length, "rollup reads at most the most recent sessions").toBeLessThanOrEqual(MAX_ROLLUP_SESSIONS);
      const result = await e.mcp.callTool({ name: "get_cost_rollup", arguments: { since: ROLLUP_SINCE, until: ROLLUP_UNTIL, limit: MAX_ROLLUP_SESSIONS } });
      expect(result.isError).toBeFalsy();
      const rollup = costRollupSchema.parse(result.structuredContent);
      expect(rollup.sessionCount, `${e.name} sessions in rollup`).toBe(inRange.length);
      for (const { session } of inRange) {
        if (session.costAiCredits.known) expected += session.costAiCredits.value;
        else {
          partialSessions += 1;
          const cost = sessionCostSchema.parse((await e.mcp.callTool({ name: "get_session_cost", arguments: { sessionId: session.id, topTurns: 1 } })).structuredContent);
          expected += cost.totals.aiCredits.value ?? 0;
        }
      }
      rollupTotal += rollup.totals.aiCredits.value ?? 0;
      sessionsInRange += inRange.length;
    }
    console.log(`rollup ${ROLLUP_SINCE}..${ROLLUP_UNTIL}: sessions=${sessionsInRange} listUnknown=${partialSessions} expected=${f(expected)} rollup=${f(rollupTotal)}`);
    expect(near(rollupTotal, expected, TOLERANCE * Math.max(1, sessionsInRange)), `rollup ${f(rollupTotal)} vs session sum ${f(expected)}`).toBe(true);
  }, 300_000);

  it("totals the missing credits of all sessions to the SA0 grand total", async () => {
    // Every measured session, with or without subagent files: the server's
    // total minus its own subagent share must leave the counted credits, and
    // the shares must add up to the oracle's grand total.
    const oracleMissing = aggregateSessions(measured.map((r) => r.summary)).missingAiCredits;
    let serverMissing = 0;
    for (const row of withSubagentFiles()) serverMissing += (await sessionCost(row)).subagents?.aiCredits ?? 0;
    // Unlisted sessions are covered by the test above; here they only add the
    // oracle's own figure, which that test requires to be 0.00.
    serverMissing += sum(allWithSubagentFiles().filter((r) => !isListed(r)).map((r) => r.summary.missingAiCredits));
    console.log(`aggregate missing: oracle=${f(oracleMissing)} server=${f(serverMissing)} sessions=${measured.length}`);
    expect(near(serverMissing, oracleMissing, TOLERANCE * Math.max(1, withSubagentFiles().length))).toBe(true);
  }, 300_000);

  it("left the log folders untouched (read-only)", () => {
    for (const [name, before] of fingerprintsBefore) expect(fingerprint(editions.get(name)!.userData, subagentSessionIds(name)) === before, `${name} log folders changed`).toBe(true);
  });
});
