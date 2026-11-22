// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Step 10.20 ST15 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/subagent-tool-audit.md §11): real-data check of
// the subagent tool calls in the tool-call audit against this machine's own
// Copilot logs. Opt-in and local only:
//
//   npm run test:real-data:tool-audit --workspace=packages/server
//   REAL_DATA_USER_DATA="<dir>,<dir>" ...   (default ~/.config/Code and "~/.config/Code - Insiders")
//
// Expected figures come from subagent-tool-audit-oracle.mts, which reads the
// raw debug logs and events.jsonl files and shares no code with the server;
// actual figures come from the server composed as the extension composes it
// (the HTTP service and an in-memory MCP client over the same dirs). Output
// carries session ids, counts and enum values only: never a prompt, argument,
// result, title or path. Read-only. Claude Code subagent calls are CS16's.
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  auditRollupSchema,
  auditedToolCallSchema,
  findingsQueryResultSchema,
  sessionAuditSchema,
  type AuditedRun,
  type AuditedToolCall,
  type OutcomeTotals,
  type SessionAudit,
} from "@agent-cost-analyzer/domain";
import { createCopilotMcpServices } from "../src/composition/create-copilot-mcp-services.js";
import { createExtensionApiService } from "../src/composition/create-extension-api-service.js";
import { resolveCopilotHome } from "../src/data-sources/agent-host/copilot-cli-paths.js";
import { listWorkspaceDebugLogsDirPaths } from "../src/data-sources/jsonl/session-log-path.js";
import { copilotChatGlobalStoragePath } from "../src/data-sources/sqlite/copilot-chat-global-storage-path.js";
import { createMcpServer } from "../src/mcp/mcp-server.js";
import type { ApiService } from "../src/services/api/api-service.js";
import { InMemoryAppSettingsStore } from "../src/test-support/in-memory-app-settings-store.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../src/test-support/vendor-profiles-dir.js";
import { agentHostCatalogSessions } from "./cost-by-project-oracle.mjs";
import {
  addCounts,
  agentHostOracle,
  classicOracle,
  emptyCounts,
  parseJsonlObjects,
  type AgentHostResult,
  type ChildFile,
  type ClassicResult,
  type OutcomeCounts,
} from "./subagent-tool-audit-oracle.mjs";

const REAL_DATA = process.env.REAL_DATA === "1";
const defaultDirs = [path.join(homedir(), ".config", "Code"), path.join(homedir(), ".config", "Code - Insiders")];
const userDataDirs = (process.env.REAL_DATA_USER_DATA?.split(",").map((d) => d.trim()).filter(Boolean) ?? defaultDirs).filter((d) => {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
});
const skipReason = !REAL_DATA ? "set REAL_DATA=1 to run" : userDataDirs.length === 0 ? "no VS Code user-data dir found (REAL_DATA_USER_DATA)" : null;

// get_audit_rollup reads at most this many recent sessions per provider.
const MAX_ROLLUP_SESSIONS = 500;
const PAGE = 1000;
// A log written this recently may still be growing: it is read, not fingerprinted.
const STABLE_MS = 10 * 60 * 1000;

// ---- the raw logs ---------------------------------------------------------------------

const safeList = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

// Session id -> folder of main.jsonl, over the per-workspace and global debug-logs.
function classicFolders(userData: string): Map<string, string> {
  const user = path.join(userData, "User");
  const roots = safeList(path.join(user, "workspaceStorage")).map((hash) => path.join(user, "workspaceStorage", hash, "GitHub.copilot-chat", "debug-logs"));
  roots.push(path.join(user, "globalStorage", "github.copilot-chat", "debug-logs"));
  const folders = new Map<string, string>();
  for (const root of roots) {
    for (const id of safeList(root)) {
      const dir = path.join(root, id);
      if (existsSync(path.join(dir, "main.jsonl"))) folders.set(id, dir);
    }
  }
  return folders;
}

// Agent Host session id -> its Copilot CLI events.jsonl, through the catalog.
function agentHostLogs(userData: string): Map<string, string> {
  const dbPath = path.join(userData, "User", "globalStorage", "agent-host.db");
  const logs = new Map<string, string>();
  if (!existsSync(dbPath)) return logs;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT s.session_uri AS uri, c.provider_data AS data FROM sessions_v2 s JOIN chats_v2 c ON c.owner_session_uri = s.session_uri WHERE s.provider = 'copilotcli'").all() as { uri: string; data: unknown }[];
    const idOf = new Map(agentHostCatalogSessions([...new Set(rows.map((r) => r.uri))].map((uri) => ({ session_uri: uri })), new Set()).map((s) => [s.row.session_uri, s.id]));
    for (const { uri, data } of rows) {
      const id = idOf.get(uri);
      if (id === undefined || logs.has(id)) continue;
      let sdk: unknown;
      try {
        sdk = typeof data === "string" ? (JSON.parse(data) as Record<string, unknown>).sdkSessionId : undefined;
      } catch {
        continue;
      }
      if (typeof sdk !== "string" || !/^[0-9A-Za-z][0-9A-Za-z-]*$/.test(sdk)) continue;
      const events = path.join(resolveCopilotHome(), "session-state", sdk, "events.jsonl");
      if (existsSync(events)) logs.set(id, events);
    }
  } finally {
    db.close();
  }
  return logs;
}

function readChild(dir: string, name: string): ChildFile {
  const file = path.join(dir, name);
  try {
    if (!lstatSync(file).isFile()) return { kind: "not-file" };
    return { kind: "text", text: readFileSync(file, "utf8") };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "missing" } : { kind: "unreadable" };
  }
}

// Names, sizes and mtimes of what the check reads: a read-only run leaves them
// unchanged. Only files untouched for STABLE_MS are listed, since a running VS
// Code keeps writing its live session's.
function fingerprint(files: readonly string[]): string {
  const out: string[] = [];
  const now = Date.now();
  for (const file of files) {
    try {
      const s = statSync(file);
      if (now - s.mtimeMs >= STABLE_MS) out.push(`${file}|${s.size}|${s.mtimeMs}`);
    } catch {
      out.push(`${file}|gone`);
    }
  }
  return out.sort().join("\n");
}

// ---- the products ---------------------------------------------------------------------

interface Edition {
  userData: string;
  name: string;
  api: ApiService;
  mcp: Client;
}

function composeEdition(userData: string): { api: ApiService; server: ReturnType<typeof createMcpServer> } {
  const paths = {
    sessionStoreDbPath: copilotChatGlobalStoragePath(userData, "session-store.db"),
    debugLogsDirPaths: listWorkspaceDebugLogsDirPaths({ userDataDir: userData }),
    agentTracesDbPath: copilotChatGlobalStoragePath(userData, "agent-traces.db"),
    agentHostUserDataDir: userData,
    copilotHome: resolveCopilotHome(),
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

// ---- one session's expected and actual figures -------------------------------------

interface Row {
  edition: string;
  id: string;
  startedAt: string | undefined;
  oracle: { kind: "classic"; result: ClassicResult } | { kind: "host"; result: AgentHostResult } | { kind: "none" };
  audit: SessionAudit;
  mcpAudit: SessionAudit;
  apiCalls: AuditedToolCall[];
  mcpCalls: AuditedToolCall[];
  mcpSubagentCalls: AuditedToolCall[];
  apiSubagentCalls: AuditedToolCall[];
  mcpText: string;
}

const canon = (value: unknown): string =>
  JSON.stringify(JSON.parse(JSON.stringify(value)), (_k, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b))) : v,
  );

const oracleMain = (row: Row): OutcomeCounts => (row.oracle.kind === "none" ? emptyCounts() : row.oracle.result.main);
const oracleRuns = (row: Row) => (row.oracle.kind === "none" ? [] : row.oracle.result.runs);
const oracleUnread = (row: Row) => (row.oracle.kind === "classic" ? row.oracle.result.unreadRuns : []);
const actualMain = (audit: SessionAudit): OutcomeTotals => audit.byOrigin?.main ?? audit.totals;
const hasRuns = (row: Row) => oracleRuns(row).length + oracleUnread(row).length > 0;

function diffCounts(actual: OutcomeTotals | null | undefined, expected: OutcomeCounts): string | null {
  if (!actual) return "totals null";
  const got = { ...emptyCounts(), ...actual, canceled: actual.canceled ?? 0 };
  const bad = (Object.keys(expected) as (keyof OutcomeCounts)[]).filter((k) => got[k] !== expected[k]);
  return bad.length === 0 ? null : bad.map((k) => `${k} ${got[k]} != ${expected[k]}`).join(", ");
}

// A group's tally for the final table.
class Group {
  checked = 0;
  problems: string[] = [];
  constructor(readonly name: string) {}
  check(ok: boolean, message: string): void {
    this.checked += 1;
    if (!ok) this.problems.push(message);
  }
}

(skipReason === null ? describe : describe.skip)(`ST15 real-data subagent tool calls in the audit${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  const editions: Edition[] = [];
  const rows: Row[] = [];
  const groups = new Map<string, Group>();
  const group = (name: string): Group => {
    const existing = groups.get(name) ?? new Group(name);
    groups.set(name, existing);
    return existing;
  };
  let fingerprintBefore = "";
  let watchedFiles: string[] = [];
  const listedById = new Map<string, number>();
  const unlistedLogs = { classic: 0, host: 0 };
  // The oracle over every raw log on the machine, listed by the server or not:
  // the figures the plan's spike (section 4) counted.
  const everything = { classicMain: emptyCounts(), classicRuns: emptyCounts(), classicRunCount: 0, hostMain: emptyCounts(), hostRuns: emptyCounts(), hostRunCount: 0, hostLogs: 0 };

  const callTool = async (e: Edition, name: string, args: Record<string, unknown>) => {
    const result = await e.mcp.callTool({ name, arguments: args });
    expect(result.isError, `${name}: ${JSON.stringify(result.content).slice(0, 200)}`).toBeFalsy();
    return result;
  };
  const mcpCallsOf = async (e: Edition, sessionId: string, filter: Record<string, unknown>): Promise<{ calls: AuditedToolCall[]; text: string }> => {
    const calls: AuditedToolCall[] = [];
    let text = "";
    for (let offset = 0; ; offset += PAGE) {
      const result = await callTool(e, "list_tool_calls", { sessionId, ...filter, offset, limit: PAGE });
      text += JSON.stringify(result.content);
      const page = result.structuredContent as { total: number; calls: unknown[] };
      calls.push(...page.calls.map((c) => auditedToolCallSchema.parse(c)));
      if (offset + PAGE >= page.total) return { calls, text };
    }
  };
  const apiCallsOf = async (e: Edition, sessionId: string, filter: Record<string, string>): Promise<AuditedToolCall[]> => {
    const calls: AuditedToolCall[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await e.api.listToolCalls(sessionId, { ...filter, offset: String(offset), limit: String(PAGE) });
      calls.push(...page.calls);
      if (offset + PAGE >= page.total) return calls;
    }
  };

  beforeAll(async () => {
    // What the run reads, fingerprinted before the first product call.
    const layouts = userDataDirs.map((userData) => ({ userData, folders: classicFolders(userData), hostLogs: agentHostLogs(userData) }));
    const watched: string[] = [];
    for (const { userData, folders, hostLogs } of layouts) {
      for (const folder of folders.values()) watched.push(...safeList(folder).filter((n) => n.endsWith(".jsonl")).map((n) => path.join(folder, n)));
      watched.push(...hostLogs.values(), path.join(userData, "User", "globalStorage", "agent-host.db"));
      for (const store of ["session-store.db", "agent-traces.db"]) {
        const file = copilotChatGlobalStoragePath(userData, store);
        if (file !== null) watched.push(file);
      }
    }
    watchedFiles = watched;
    fingerprintBefore = fingerprint(watched);

    const sessionState = path.join(resolveCopilotHome(), "session-state");
    for (const id of safeList(sessionState)) {
      const log = path.join(sessionState, id, "events.jsonl");
      if (!existsSync(log)) continue;
      const r = agentHostOracle(parseJsonlObjects(readFileSync(log, "utf8")));
      everything.hostLogs += 1;
      everything.hostMain = addCounts(everything.hostMain, r.main);
      everything.hostRunCount += r.runs.length;
      for (const run of r.runs) everything.hostRuns = addCounts(everything.hostRuns, run.counts);
    }
    for (const { folders } of layouts) {
      for (const [id, folder] of folders) {
        const r = classicOracle({ folderId: id, mainText: readFileSync(path.join(folder, "main.jsonl"), "utf8"), names: safeList(folder), read: (n) => readChild(folder, n) });
        everything.classicMain = addCounts(everything.classicMain, r.main);
        everything.classicRunCount += r.runs.length;
        for (const run of r.runs) everything.classicRuns = addCounts(everything.classicRuns, run.counts);
      }
    }

    for (const { userData, folders, hostLogs } of layouts) {
      const name = path.basename(userData);
      const { api, server } = composeEdition(userData);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const mcp = new Client({ name: "st15-real-data", version: "1.0.0" });
      await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
      const edition: Edition = { userData, name, api, mcp };
      editions.push(edition);

      const sessions = await api.listSessions();
      const listed = new Set(sessions.map((s) => s.id));
      unlistedLogs.classic += [...folders.keys()].filter((id) => !listed.has(id)).length;
      unlistedLogs.host += [...hostLogs.keys()].filter((id) => !listed.has(id)).length;

      for (const session of sessions) {
        listedById.set(session.id, (listedById.get(session.id) ?? 0) + 1);
        const folder = folders.get(session.id);
        const hostLog = hostLogs.get(session.id);
        let oracle: Row["oracle"] = { kind: "none" };
        if (folder !== undefined) {
          oracle = { kind: "classic", result: classicOracle({ folderId: session.id, mainText: readFileSync(path.join(folder, "main.jsonl"), "utf8"), names: safeList(folder), read: (n) => readChild(folder, n) }) };
        } else if (hostLog !== undefined) {
          oracle = { kind: "host", result: agentHostOracle(parseJsonlObjects(readFileSync(hostLog, "utf8"))) };
        }
        const audit = await api.getSessionAudit(session.id);
        const mcpAudit = sessionAuditSchema.partial({ calls: true }).parse((await callTool(edition, "get_session_audit", { sessionId: session.id })).structuredContent) as SessionAudit;
        const all = await mcpCallsOf(edition, session.id, {});
        const sub = await mcpCallsOf(edition, session.id, { origin: ["subagent"] });
        rows.push({
          edition: name,
          id: session.id,
          startedAt: session.startedAt,
          oracle,
          audit,
          mcpAudit,
          apiCalls: await apiCallsOf(edition, session.id, {}),
          mcpCalls: all.calls,
          mcpSubagentCalls: sub.calls,
          apiSubagentCalls: await apiCallsOf(edition, session.id, { origin: "subagent" }),
          mcpText: all.text,
        });
      }
    }
  }, 900_000);

  afterAll(async () => {
    console.log("ST15 groups (checks / failures):");
    for (const g of groups.values()) console.log(`  ${g.name}: checks=${g.checked} failures=${g.problems.length}`);
    for (const e of editions) await e.mcp.close();
  });

  const finish = (g: Group) => {
    for (const p of g.problems.slice(0, 40)) console.log(`PROBLEM ${g.name}: ${p}`);
    expect(g.problems).toEqual([]);
  };

  it("measures the oracle's baseline", () => {
    const classic = rows.filter((r) => r.oracle.kind === "classic");
    const host = rows.filter((r) => r.oracle.kind === "host");
    const withRuns = rows.filter(hasRuns);
    const runs = rows.flatMap(oracleRuns);
    const unread = rows.flatMap(oracleUnread);
    const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
    console.log(`sessions: listed=${rows.length} classic=${classic.length} agentHost=${host.length} noLog=${rows.length - classic.length - host.length} unlistedClassicLogs=${unlistedLogs.classic} unlistedHostLogs=${unlistedLogs.host}`);
    console.log(`sessions with runs: classic=${withRuns.filter((r) => r.oracle.kind === "classic").length} agentHost=${withRuns.filter((r) => r.oracle.kind === "host").length}`);
    console.log(`runs read: classic=${runs.length - rows.filter((r) => r.oracle.kind === "host").reduce((a, r) => a + oracleRuns(r).length, 0)} agentHost=${rows.filter((r) => r.oracle.kind === "host").reduce((a, r) => a + oracleRuns(r).length, 0)} predictedUnread=${unread.length} (${[...new Set(unread.map((u) => u.cause))].map((c) => `${c}:${unread.filter((u) => u.cause === c).length}`).join(" ")}) unplacedClassicLogs=${sum((r) => (r.oracle.kind === "classic" ? r.oracle.result.unplaced : 0))} nestedRefs=${sum((r) => (r.oracle.kind === "classic" ? r.oracle.result.nestedRefs : 0))}`);
    const byKind = (kind: "classic" | "host") => rows.filter((r) => r.oracle.kind === kind).reduce((acc, r) => addCounts(acc, oracleRuns(r).reduce((a, run) => addCounts(a, run.counts), emptyCounts())), emptyCounts());
    const mainOf = (kind: "classic" | "host") => rows.filter((r) => r.oracle.kind === kind).reduce((acc, r) => addCounts(acc, oracleMain(r)), emptyCounts());
    console.log(`oracle main calls: classic=${JSON.stringify(mainOf("classic"))} agentHost=${JSON.stringify(mainOf("host"))}`);
    console.log(`oracle subagent calls: classic=${JSON.stringify(byKind("classic"))} agentHost=${JSON.stringify(byKind("host"))}`);
    const timePlaced = rows.reduce((a, r) => a + (r.oracle.kind === "classic" ? r.oracle.result.runs.filter((run) => run.matchedByTime).length : 0), 0);
    const flagged = rows.reduce((a, r) => a + (r.oracle.kind === "host" ? r.oracle.result.runs.filter((run) => run.flagged).length : 0), 0);
    console.log(`runs placed by time (classic): ${timePlaced}; flagged agent-host runs: ${flagged}`);
    console.log(`oracle over every raw log, listed or not: classic main=${JSON.stringify(everything.classicMain)} runs=${everything.classicRunCount} calls=${JSON.stringify(everything.classicRuns)}`);
    console.log(`oracle over every raw log, listed or not: agent host logs=${everything.hostLogs} main=${JSON.stringify(everything.hostMain)} runs=${everything.hostRunCount} calls=${JSON.stringify(everything.hostRuns)}`);
    console.log(`duplicate call ids the oracle dropped: ${sum((r) => (r.oracle.kind === "classic" ? r.oracle.result.duplicateCallIds : 0))}`);
    expect(runs.length + unread.length, "no session with subagent runs on this machine: nothing to check").toBeGreaterThan(0);
    for (const [id, n] of listedById) expect(n, `session ${id} listed by two editions`).toBe(1);
  });

  it("main-agent counts per status equal the oracle's", () => {
    const g = group("main-agent counts");
    for (const row of rows.filter((r) => r.oracle.kind !== "none" && r.audit.toolCallsUnavailableReason === undefined)) {
      const diff = diffCounts(actualMain(row.audit), oracleMain(row));
      g.check(diff === null, `${row.id} ${row.oracle.kind}: ${diff}`);
    }
    finish(g);
  });

  it("per-run counts equal the oracle's, and the run rows are exactly the predicted ones", () => {
    const g = group("per-run counts");
    for (const row of rows.filter((r) => r.oracle.kind !== "none" && r.audit.toolCallsUnavailableReason === undefined)) {
      const runs = row.audit.subagentRuns ?? [];
      const byId = new Map<string, AuditedRun>();
      for (const run of runs) {
        g.check(!byId.has(run.runId), `${row.id} run id ${run.runId} listed twice`);
        byId.set(run.runId, run);
      }
      for (const expected of oracleRuns(row)) {
        const actual = byId.get(expected.runId);
        g.check(actual !== undefined, `${row.id} run ${expected.runId} missing from the audit`);
        if (!actual) continue;
        const diff = diffCounts(actual.totals, expected.counts);
        g.check(diff === null, `${row.id} run ${expected.runId}: ${diff}`);
        if (row.oracle.kind === "classic") {
          const wantByTime = (expected as { matchedByTime: boolean }).matchedByTime;
          g.check((actual.matchedByTime ?? false) === wantByTime, `${row.id} run ${expected.runId}: matchedByTime ${actual.matchedByTime ?? false} != ${wantByTime}`);
        } else {
          const flagged = (expected as { flagged: boolean }).flagged;
          g.check((actual.unreadReason !== undefined) === flagged && actual.totals !== null, `${row.id} run ${expected.runId}: flag ${actual.unreadReason !== undefined} != ${flagged}`);
        }
      }
      const readIds = new Set(oracleRuns(row).map((r) => r.runId));
      const unreadRows = runs.filter((r) => !readIds.has(r.runId));
      g.check(unreadRows.length === oracleUnread(row).length, `${row.id}: ${unreadRows.length} other run rows, oracle predicts ${oracleUnread(row).length} unread`);
    }
    finish(g);
  });

  it("every unread run the oracle predicts is unread with a reason, never 0", () => {
    const g = group("unread runs");
    for (const row of rows.filter((r) => r.oracle.kind === "classic")) {
      const runs = row.audit.subagentRuns ?? [];
      for (const unread of oracleUnread(row)) {
        if (unread.runId === null) continue;
        const actual = runs.find((r) => r.runId === unread.runId);
        g.check(actual !== undefined && actual.totals === null && (actual.unreadReason ?? "") !== "" && actual.failureRate === null, `${row.id} unread run ${unread.runId} (${unread.cause}): ${actual ? `totals ${actual.totals === null ? "null" : "known"}` : "no row"}`);
      }
      const reasons = row.audit.outcomeCoverage.unknownReasons.length;
      g.check(oracleUnread(row).length === 0 || reasons > 0, `${row.id}: unread runs but no coverage reason`);
      g.check(
        oracleUnread(row).length === 0 || (row.audit.byOrigin?.subagents.runs ?? 0) >= oracleUnread(row).length,
        `${row.id}: byOrigin.subagents.runs ${row.audit.byOrigin?.subagents.runs} < predicted unread ${oracleUnread(row).length}`,
      );
    }
    finish(g);
  });

  it("an Agent Host session has tool calls exactly when its event log exists", () => {
    const g = group("agent host availability");
    for (const row of rows) {
      const hostLogGone = row.oracle.kind === "none" && row.audit.toolCallsUnavailableReason !== undefined;
      if (row.oracle.kind === "host") g.check(row.audit.toolCallsUnavailableReason === undefined, `${row.id}: event log exists but calls are unavailable`);
      if (hostLogGone) g.check(row.audit.calls.length === 0 && row.audit.totals.toolCalls === 0, `${row.id}: unavailable but counts calls`);
    }
    finish(g);
  });

  it("never counts a call twice, and every subagent call carries its run", () => {
    const g = group("no double count");
    for (const row of rows) {
      for (const [where, calls] of [["http", row.apiCalls], ["mcp", row.mcpCalls]] as const) {
        const ids = calls.flatMap(({ call }) => (call.id === undefined ? [] : [call.id]));
        g.check(new Set(ids).size === ids.length, `${row.id} ${where}: ${ids.length - new Set(ids).size} call ids twice`);
      }
      const runs = new Map((row.audit.subagentRuns ?? []).map((r) => [r.runId, r]));
      for (const { call } of row.apiCalls) {
        if (call.origin?.kind !== "subagent") continue;
        const run = runs.get(call.origin.runId);
        g.check(run !== undefined && run.label === call.origin.label, `${row.id} call of run ${call.origin.runId}: label ${call.origin.label} vs run ${run?.label}`);
      }
      g.check(row.apiCalls.length === row.audit.totals.toolCalls || row.audit.toolCallsUnavailableReason !== undefined, `${row.id}: ${row.apiCalls.length} listed calls vs totals ${row.audit.totals.toolCalls}`);
    }
    finish(g);
  });

  it("byOrigin.main + subagents = totals", () => {
    const g = group("byOrigin sums");
    for (const row of rows) {
      const o = row.audit.byOrigin;
      g.check((o !== undefined) === ((row.audit.subagentRuns ?? []).length > 0), `${row.id}: byOrigin ${o ? "present" : "absent"} with ${(row.audit.subagentRuns ?? []).length} runs`);
      if (!o) continue;
      const keys = ["toolCalls", "succeeded", "failed", "interrupted", "denied", "unknown"] as const;
      for (const k of keys) g.check(o.main[k] + o.subagents[k] === row.audit.totals[k], `${row.id} ${k}: ${o.main[k]} + ${o.subagents[k]} != ${row.audit.totals[k]}`);
      g.check((o.main.canceled ?? 0) + (o.subagents.canceled ?? 0) === (row.audit.totals.canceled ?? 0), `${row.id} canceled sum`);
      const fromRuns = (row.audit.subagentRuns ?? []).reduce((a, r) => a + (r.totals?.toolCalls ?? 0), 0);
      g.check(fromRuns === o.subagents.toolCalls, `${row.id}: runs sum ${fromRuns} != subagents ${o.subagents.toolCalls}`);
      g.check(o.subagents.runs === (row.audit.subagentRuns ?? []).length, `${row.id}: subagents.runs ${o.subagents.runs} != ${(row.audit.subagentRuns ?? []).length} rows`);
    }
    finish(g);
  });

  it("HTTP and MCP answers are equal", () => {
    const g = group("HTTP == MCP");
    const blank = ({ turnIndex, call }: AuditedToolCall): AuditedToolCall => ({ turnIndex, call: call.kind === "subagent" ? { ...call, argsSummary: "" } : call });
    for (const row of rows) {
      const { calls: _calls, ...httpAudit } = row.audit;
      void _calls;
      const { calls: _mcpCalls, ...mcpAudit } = row.mcpAudit;
      void _mcpCalls;
      g.check(canon(httpAudit) === canon(mcpAudit), `${row.id}: get_session_audit differs from the HTTP audit`);
      g.check(canon(row.apiCalls.map(blank)) === canon(row.mcpCalls), `${row.id}: list_tool_calls differs from HTTP`);
      g.check(canon(row.apiSubagentCalls.map(blank)) === canon(row.mcpSubagentCalls), `${row.id}: origin=subagent list differs from HTTP`);
      const expectedSub = row.apiCalls.filter(({ call }) => call.origin?.kind === "subagent").length;
      g.check(row.apiSubagentCalls.length === expectedSub, `${row.id}: origin filter keeps ${row.apiSubagentCalls.length} of ${expectedSub} subagent calls`);
      g.check(row.apiSubagentCalls.length === (row.audit.byOrigin?.subagents.toolCalls ?? 0), `${row.id}: filter ${row.apiSubagentCalls.length} vs byOrigin ${row.audit.byOrigin?.subagents.toolCalls ?? 0}`);
    }
    finish(g);
  });

  it("MCP output carries no subagent prompt text and blanks subagent-kind arguments", () => {
    const g = group("MCP prompt text");
    let prompts = 0;
    let httpHasPrompt = 0;
    for (const row of rows) {
      const inputs = row.oracle.kind === "none" ? [] : row.oracle.result.subagentInputs;
      prompts += inputs.length;
      for (const input of inputs) {
        g.check(!row.mcpText.includes(JSON.stringify(input).slice(1, -1)), `${row.id}: a subagent input appears in list_tool_calls output`);
        g.check(!JSON.stringify(row.mcpAudit).includes(JSON.stringify(input).slice(1, -1)), `${row.id}: a subagent input appears in get_session_audit output`);
        if (JSON.stringify(row.apiCalls).includes(JSON.stringify(input.slice(0, 40)).slice(1, -1))) httpHasPrompt += 1;
      }
      for (const { call } of row.mcpCalls) if (call.kind === "subagent") g.check(call.argsSummary === "", `${row.id}: subagent call keeps an argument summary over MCP`);
    }
    console.log(`subagent-starting call inputs checked: ${prompts} (cut to 300 chars on the HTTP side in ${httpHasPrompt} sessions' output, blanked over MCP)`);
    finish(g);
  });

  it("findings from subagent calls carry that call's origin", async () => {
    const g = group("findings origin");
    const bySession = new Map(rows.map((r) => [`${r.edition}:${r.id}`, r]));
    let security = 0;
    let fromSubagents = 0;
    for (const e of editions) {
      const editionRows = rows.filter((r) => r.edition === e.name && r.startedAt !== undefined);
      if (editionRows.length === 0) continue;
      const dates = editionRows.map((r) => r.startedAt!.slice(0, 10)).sort();
      const args = { since: dates[0], until: dates[dates.length - 1], limit: MAX_ROLLUP_SESSIONS, maxResults: PAGE, kind: ["security"] };
      for (const origin of [["subagent"], ["main"]] as const) {
        const result = findingsQueryResultSchema.parse((await callTool(e, "list_findings", { ...args, origin })).structuredContent);
        for (const finding of result.findings) {
          security += 1;
          if (finding.origin?.kind === "subagent") fromSubagents += 1;
          const match = /^(?:[^:]+):(.+):(\d+):(\d+)$/.exec(finding.toolCallKey ?? "");
          g.check(match !== null, `finding key ${finding.key.slice(0, 8)}: unreadable toolCallKey`);
          if (!match) continue;
          const row = bySession.get(`${e.name}:${match[1]}`);
          const call = row?.audit.calls.filter((c) => c.turnIndex === Number(match[2]))[Number(match[3])]?.call;
          g.check(call !== undefined, `${match[1]}: finding names no call`);
          if (!call) continue;
          g.check(canon(call.origin ?? { kind: "main" }) === canon(finding.origin ?? { kind: "main" }), `${match[1]}: finding origin ${finding.origin?.kind ?? "main"} != call origin ${call.origin?.kind ?? "main"}`);
          g.check((finding.origin?.kind ?? "main") === origin[0], `${match[1]}: origin filter ${origin[0]} returned ${finding.origin?.kind ?? "main"}`);
        }
      }
    }
    console.log(`security findings checked: ${security} (${fromSubagents} from subagent calls)`);
    finish(g);
  }, 300_000);

  it("get_audit_rollup: HTTP == MCP, and byOrigin equals the sum over the oracle's sessions", async () => {
    const g = group("rollup");
    for (const e of editions) {
      const editionRows = rows.filter((r) => r.edition === e.name && r.startedAt !== undefined);
      if (editionRows.length === 0) continue;
      const dates = editionRows.map((r) => r.startedAt!.slice(0, 10)).sort();
      const since = dates[0]!;
      const until = dates[dates.length - 1]!;
      const api = await e.api.getAuditRollup({ since, until, limit: String(MAX_ROLLUP_SESSIONS) });
      const mcp = auditRollupSchema.parse((await callTool(e, "get_audit_rollup", { since, until, limit: MAX_ROLLUP_SESSIONS })).structuredContent);
      g.check(canon(api) === canon(mcp), `${e.name}: get_audit_rollup differs from the HTTP rollup`);
      // The most recent sessions in the window; those whose calls are unknown are left out.
      const inWindow = editionRows.sort((a, b) => b.startedAt!.localeCompare(a.startedAt!)).slice(0, MAX_ROLLUP_SESSIONS);
      const counted = inWindow.filter((r) => r.audit.toolCallsUnavailableReason === undefined);
      g.check(api.sessionCount === counted.length, `${e.name}: rollup counts ${api.sessionCount} sessions, expected ${counted.length}`);
      g.check(api.sessionsWithUnknownToolCalls === inWindow.length - counted.length, `${e.name}: sessionsWithUnknownToolCalls ${api.sessionsWithUnknownToolCalls} != ${inWindow.length - counted.length}`);
      // A session without a raw log to read here is expected as the audit says.
      const expectedMain = counted.reduce((a, r) => addCounts(a, r.oracle.kind === "none" ? { ...emptyCounts(), ...actualMain(r.audit), canceled: actualMain(r.audit).canceled ?? 0 } : oracleMain(r)), emptyCounts());
      const expectedRuns = counted.reduce((a, r) => addCounts(a, oracleRuns(r).reduce((s, run) => addCounts(s, run.counts), emptyCounts())), emptyCounts());
      const o = api.byOrigin;
      g.check(diffCounts(o?.main ?? api.totals, expectedMain) === null, `${e.name}: rollup main ${diffCounts(o?.main ?? api.totals, expectedMain)}`);
      g.check(diffCounts(o?.subagents, expectedRuns) === null || (o === undefined && expectedRuns.toolCalls === 0), `${e.name}: rollup subagents ${diffCounts(o?.subagents, expectedRuns)}`);
      g.check(api.totals.toolCalls === expectedMain.toolCalls + expectedRuns.toolCalls, `${e.name}: rollup totals ${api.totals.toolCalls} != ${expectedMain.toolCalls + expectedRuns.toolCalls}`);
      const withUnread = counted.filter((r) => (r.audit.subagentRuns ?? []).some((run) => run.totals === null)).length;
      g.check(api.sessionsWithUnreadSubagentRuns === withUnread, `${e.name}: sessionsWithUnreadSubagentRuns ${api.sessionsWithUnreadSubagentRuns} != ${withUnread}`);
      const predictedUnread = counted.filter((r) => oracleUnread(r).length > 0).length;
      g.check(api.sessionsWithUnreadSubagentRuns === predictedUnread, `${e.name}: sessionsWithUnreadSubagentRuns ${api.sessionsWithUnreadSubagentRuns} != oracle ${predictedUnread}`);
      console.log(`rollup ${e.name}: sessions=${api.sessionCount} subagentCalls=${o?.subagents.toolCalls ?? 0} mainCalls=${(o?.main ?? api.totals).toolCalls} sessionsWithUnreadRuns=${api.sessionsWithUnreadSubagentRuns}`);
    }
    finish(g);
  }, 300_000);

  it("left the logs and stores untouched (read-only)", () => {
    const g = group("read-only");
    // Only files that were already stable are compared (a running VS Code
    // keeps writing its live session's); the first fingerprint is from before
    // the first product read.
    g.check(fingerprint(watchedFiles) === fingerprintBefore, "a log or store file changed during the check");
    g.check(watchedFiles.length > 0, "no file was watched");
    console.log(`files fingerprinted: ${fingerprintBefore.split("\n").filter(Boolean).length} of ${watchedFiles.length} watched`);
    finish(g);
  });
});
