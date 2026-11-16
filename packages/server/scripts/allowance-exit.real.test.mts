// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// MS10: the monthly allowance's exit criterion as an automated check
// (docs/plans/monthly-allowance-standalone.md §11, D11; 1.0 criterion C9), over
// this machine's own Copilot logs. Opt-in and local only:
//
//   npm run test:real-data:allowance
//   REAL_DATA_USER_DATA="<dir>"   (default: the VS Code user-data dir the app picks)
//   COPILOT_HOME="<dir>"          (default ~/.copilot, as the Copilot CLI resolves it)
//
// Expected figures come from allowance-oracle.mts, which reads the raw logs and
// shares no code with the product. Actual figures come from the standalone
// app's HTTP app (GET /api/monthly-allowance, as the header calls it) and its
// stdio MCP server's composition (get_monthly_allowance), each composed as the
// app composes it, with a clock set inside each period checked.
//
// Both sides read one frozen copy of the data:
//   - the Copilot Chat session store, VS Code's Agent Host catalog and each
//     Agent Host session.db: snapshots (SQLite VACUUM INTO, a consistent read
//     of the live file) in a temporary user-data folder named as the real one;
//   - the debug logs: a view of the stable session folders (a symlink per
//     folder); a folder with a file written in the last 15 minutes is a live
//     session, left out and counted (both sides then see that session as one
//     without a log: unknown);
//   - the app's settings: a temporary copy of the settings folder, where the
//     check's PUT sets a test allowance and each reset day checked. The
//     owner's settings folder is never written.
// The Copilot CLI's event logs are read in place (the product reads only a
// titled session's first prompt from them); a log written in the last 15
// minutes is left out of the cross-check.
//
// Checked for each reset day, in the current period and the two previous full
// periods (D11): the state, the coverage, `used` within 0.01 AI Credits of the
// oracle's sum of known sessions, "at least", the oldest day counted, the
// by-harness split, the period's days and zone, never `used: 0` with no known
// session; the HTTP answer and the MCP tool's answer equal; no id, path or
// title in either; the logs and the owner's settings folder unchanged.
//
// Output carries counts, dates, sums, reset days and short hashes of session
// ids, never a prompt, title, path or file content. Read-only.
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { monthlyAllowanceAnswerSchema, type MonthlyAllowanceAnswer } from "@agent-cost-analyzer/domain";
import { createApp } from "../src/app.js";
import type { LogProviderCompositionOptions } from "../src/composition/compose-log-providers.js";
import { createStandaloneMcpServerFactory } from "../src/mcp/standalone-mcp-server.js";
import { resolveAppSettingsDir } from "../src/platform/app-settings-dir/resolve-app-settings-dir.js";
import { resolveUserDataDir } from "../src/platform/vscode-paths/resolve-user-data-dir.js";
import {
  agentHostIdOf,
  agentHostSession,
  allowanceIn,
  classicSession,
  dayKeyIn,
  daysBetween,
  eventLogCredits,
  firstLogEventMs,
  inClassicScope,
  instantInside,
  periodBack,
  type OracleAllowance,
  type OraclePeriod,
  type OracleSession,
} from "./allowance-oracle.mjs";
import type { AgentHostStoreTurn } from "./cost-by-project-oracle.mjs";
import { parseJsonl } from "./savings-oracle.mjs";
import { classifySubagentFileName, summarizeSession } from "./subagent-spend-lib.mjs";

const REAL_DATA = process.env.REAL_DATA === "1";
const HOME = homedir();
const USER_DATA = process.env.REAL_DATA_USER_DATA?.trim() || resolveUserDataDir();
// The Copilot CLI's home, resolved as the CLI does (COPILOT_HOME, else ~/.copilot).
const COPILOT_HOME = process.env.COPILOT_HOME?.trim() ? process.env.COPILOT_HOME : path.join(HOME, ".copilot");
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// A test figure for the check's own settings copy, not a plan amount.
const TEST_ALLOWANCE = 1000;
const WARN_AT_PERCENT = 80;
// The default reset day, and a mid-month one whose periods cross a month end.
const RESET_DAYS = [1, 15] as const;
const PERIODS_BACK = [0, 1, 2] as const; // D11: the current period and the two previous full ones
// The answer rounds its sums to cents; the plan's tolerance.
const TOLERANCE = 0.01;
const LIVE_MS = 15 * 60_000;
// The URI scheme the product's catalog reader takes (step 10.13); rows under
// another scheme are counted apart, so a difference they make is named.
const PRODUCT_SCHEME = "copilotcli";
const SAFE_ID = /^[0-9A-Za-z][0-9A-Za-z-]*$/;
// The fixed label the answer gives each VS Code variant (plan §4.4).
const VARIANT_LABELS: Readonly<Record<string, string>> = { Code: "VS Code", "Code - Insiders": "VS Code Insiders" };

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const skipReason = !REAL_DATA ? "set REAL_DATA=1 to run" : USER_DATA === null || !isDir(USER_DATA) ? "no VS Code user-data dir on this machine" : null;

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const tag = (id: string) => sha256(id).slice(0, 8);
const round = (n: number | null | undefined) => (n === null || n === undefined ? "-" : n.toFixed(2));
const near = (actual: number, expected: number) => Math.abs(actual - expected) <= TOLERANCE + 1e-9;

const summary: string[] = [];
const say = (line: string) => summary.push(line);

// ---- the frozen copy -----------------------------------------------------------

// A consistent copy of a SQLite file, read-only on the source. false: no
// readable source (the product then finds no file, as the oracle does).
function snapshotDb(source: string, target: string): boolean {
  if (!existsSync(source)) return false;
  mkdirSync(path.dirname(target), { recursive: true });
  try {
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      db.prepare("VACUUM INTO ?").run(target);
    } finally {
      db.close();
    }
    return true;
  } catch {
    rmSync(target, { force: true });
    return false;
  }
}

const latestWrite = (dir: string): number => Math.max(statSync(dir).mtimeMs, ...readdirSync(dir).map((name) => lstatSync(path.join(dir, name)).mtimeMs));

// Copilot Chat's debug-log folders, workspaces first (sorted), the empty
// window's global folder last.
function debugLogRoots(userData: string): string[] {
  const user = path.join(userData, "User");
  const workspaces = path.join(user, "workspaceStorage");
  const roots = isDir(workspaces) ? readdirSync(workspaces).sort().map((hash) => path.join(workspaces, hash, "GitHub.copilot-chat", "debug-logs")) : [];
  roots.push(path.join(user, "globalStorage", "github.copilot-chat", "debug-logs"));
  return roots.filter(isDir);
}

interface LogView {
  roots: string[]; // the view's roots, in the real roots' order
  stableFiles: string[]; // the real files behind the view, for the fingerprint
  folders: number;
  live: number;
}

function buildLogView(userData: string, snapshot: string, now: number): LogView {
  const view: LogView = { roots: [], stableFiles: [], folders: 0, live: 0 };
  for (const root of debugLogRoots(userData)) {
    const viewRoot = path.join(snapshot, path.relative(userData, root));
    mkdirSync(viewRoot, { recursive: true });
    view.roots.push(viewRoot);
    for (const name of readdirSync(root).sort()) {
      const folder = path.join(root, name);
      if (!isDir(folder)) continue;
      if (now - latestWrite(folder) < LIVE_MS) {
        view.live += 1;
        continue;
      }
      symlinkSync(folder, path.join(viewRoot, name), "dir");
      view.folders += 1;
      for (const file of readdirSync(folder).sort()) if (statSync(path.join(folder, file)).isFile()) view.stableFiles.push(path.join(folder, file));
    }
  }
  return view;
}

// ---- the oracle's sessions, read raw from the frozen copy -----------------------

interface ClassicRead {
  sessions: OracleSession[];
  rows: number;
  outOfScope: number;
  titles: string[]; // the privacy check's needles, never printed
  edges: { id: string; createdKey: string; firstLogKey: string }[];
  // Debug-log folders with no store row: the §18.2 scope can't be applied
  // without one, so they count in no period (reported, not compared).
  logOnly: { folders: number; withCredits: number };
}

const subagentLogsOf = (dir: string) =>
  readdirSync(dir)
    .filter((name) => classifySubagentFileName(name) !== null)
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf-8") }));

function readClassic(storePath: string, roots: readonly string[]): ClassicRead {
  const out: ClassicRead = { sessions: [], rows: 0, outOfScope: 0, titles: [], edges: [], logOnly: { folders: 0, withCredits: 0 } };
  if (!existsSync(storePath)) return out;
  const db = new DatabaseSync(storePath, { readOnly: true });
  let rows: { id: string; created_at: string | null; host_type: string | null; agent_name: string | null; summary: string | null }[];
  let turns: { session_id: string; turn_index: number; user_message: string | null }[];
  try {
    const columns = new Set((db.prepare("PRAGMA table_info(sessions)").all() as unknown as { name: string }[]).map((c) => c.name));
    const column = (name: string) => (columns.has(name) ? name : `NULL AS ${name}`);
    rows = db.prepare(`SELECT id, created_at, ${column("host_type")}, ${column("agent_name")}, ${column("summary")} FROM sessions`).all() as unknown as typeof rows;
    turns = db.prepare("SELECT session_id, turn_index, user_message FROM turns ORDER BY session_id, turn_index").all() as unknown as typeof turns;
  } finally {
    db.close();
  }
  out.rows = rows.length;
  const turnsBySession = new Map<string, (string | null)[]>();
  for (const t of turns) turnsBySession.set(t.session_id, [...(turnsBySession.get(t.session_id) ?? []), t.user_message]);
  for (const row of rows) {
    if (row.summary) out.titles.push(row.summary);
    if (!inClassicScope(row)) {
      out.outOfScope += 1;
      continue;
    }
    const dir = roots.map((root) => path.join(root, row.id)).find((candidate) => existsSync(path.join(candidate, "main.jsonl")));
    const mainText = dir ? readFileSync(path.join(dir, "main.jsonl"), "utf-8") : null;
    const files = dir ? subagentLogsOf(dir) : [];
    const session = classicSession({ id: row.id, createdAt: row.created_at, storePrompts: turnsBySession.get(row.id) ?? [], mainText, files });
    out.sessions.push(session);
    const firstLog = mainText === null ? null : firstLogEventMs(mainText);
    if (session.startMs !== null && firstLog !== null) {
      const createdKey = dayKeyIn(session.startMs, TIME_ZONE);
      const firstLogKey = dayKeyIn(firstLog, TIME_ZONE);
      if (createdKey !== firstLogKey) out.edges.push({ id: row.id, createdKey, firstLogKey });
    }
  }
  const storeIds = new Set(rows.map((row) => row.id));
  for (const root of roots) {
    for (const name of readdirSync(root)) {
      const dir = path.join(root, name);
      if (storeIds.has(name) || !existsSync(path.join(dir, "main.jsonl"))) continue;
      out.logOnly.folders += 1;
      const spend = summarizeSession({ mainText: readFileSync(path.join(dir, "main.jsonl"), "utf-8"), files: subagentLogsOf(dir) });
      if (spend.mainAiCredits + spend.missingAiCredits > 0) out.logOnly.withCredits += 1;
    }
  }
  return out;
}

interface AgentHostRead {
  sessions: OracleSession[];
  rows: number;
  tombstoned: number;
  neverSent: number;
  stores: number;
  sdkIds: string[];
  rowsByScheme: Map<string, number>;
  noId: number;
  // Sessions under a scheme the product's reader doesn't take: their ids.
  otherScheme: Set<string>;
  logCheck: { agree: number; differ: string[]; withoutRecords: number; noLog: number; live: number; unknownInStore: number };
  stableFiles: string[];
}

// The catalog's Copilot CLI sessions (not tombstoned) and each one's session.db,
// snapshotted from the real user-data dir; the event log cross-checks the bill.
function readAgentHost(userData: string, snapshot: string, now: number): AgentHostRead {
  const out: AgentHostRead = { sessions: [], rows: 0, tombstoned: 0, neverSent: 0, stores: 0, sdkIds: [], rowsByScheme: new Map(), noId: 0, otherScheme: new Set(), logCheck: { agree: 0, differ: [], withoutRecords: 0, noLog: 0, live: 0, unknownInStore: 0 }, stableFiles: [] };
  const catalogPath = path.join(snapshot, "User", "globalStorage", "agent-host.db");
  if (!snapshotDb(path.join(userData, "User", "globalStorage", "agent-host.db"), catalogPath)) return out;
  const catalog = new DatabaseSync(catalogPath, { readOnly: true });
  let rows: { session_uri: string; start_time: number | null }[];
  let tombstones: Set<string>;
  let chats: { owner_session_uri: string; provider_data: unknown }[];
  try {
    tombstones = new Set((catalog.prepare("SELECT key FROM metadata WHERE value = 'true'").all() as unknown as { key: string }[]).map((r) => r.key));
    rows = catalog.prepare("SELECT session_uri, start_time FROM sessions_v2 WHERE provider = 'copilotcli'").all() as unknown as typeof rows;
    chats = catalog.prepare("SELECT owner_session_uri, provider_data FROM chats_v2").all() as unknown as typeof chats;
  } finally {
    catalog.close();
  }
  out.rows = rows.length;
  for (const row of rows) {
    const scheme = row.session_uri.split(":")[0]!;
    out.rowsByScheme.set(scheme, (out.rowsByScheme.get(scheme) ?? 0) + 1);
    const id = agentHostIdOf(row.session_uri);
    if (id === null) {
      out.noId += 1;
      continue;
    }
    if (tombstones.has(`sessionTombstone:${row.session_uri}`)) {
      out.tombstoned += 1;
      continue;
    }
    const realStore = path.join(userData, "agentSessionData", id, "session.db");
    const store = path.join(snapshot, "agentSessionData", id, "session.db");
    let storeTurns: AgentHostStoreTurn[] | null = null;
    if (snapshotDb(realStore, store)) {
      out.stores += 1;
      if (now - statSync(realStore).mtimeMs >= LIVE_MS) out.stableFiles.push(realStore);
      const db = new DatabaseSync(store, { readOnly: true });
      try {
        const columns = (db.prepare("PRAGMA table_info(turns)").all() as unknown as { name: string }[]).map((c) => c.name);
        if (columns.length > 0) {
          const hasUsage = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'turn_usage'").all() as unknown[]).length > 0;
          const eventId = columns.includes("event_id") ? "t.event_id" : "NULL";
          storeTurns = db
            .prepare(`SELECT t.id AS id, ${eventId} AS event_id, ${hasUsage ? "u.usage" : "NULL"} AS usage FROM turns AS t ${hasUsage ? "LEFT JOIN turn_usage AS u ON u.turn_id = t.id" : ""} ORDER BY t.rowid`)
            .all() as unknown as AgentHostStoreTurn[];
        }
      } finally {
        db.close();
      }
    }
    const session = agentHostSession({ id, startTimeMs: typeof row.start_time === "number" ? row.start_time : null, storeTurns });
    if (session === null) {
      out.neverSent += 1;
      continue;
    }
    out.sessions.push(session);
    if (scheme !== PRODUCT_SCHEME) out.otherScheme.add(id);

    // The Copilot CLI's own record of the bill, where it keeps one.
    const sdk = chats
      .filter((c) => c.owner_session_uri === row.session_uri)
      .map((c) => {
        try {
          return (JSON.parse(String(c.provider_data)) as { sdkSessionId?: unknown }).sdkSessionId;
        } catch {
          return undefined;
        }
      })
      .find((s): s is string => typeof s === "string" && SAFE_ID.test(s));
    if (sdk) out.sdkIds.push(sdk);
    const logPath = sdk ? path.join(COPILOT_HOME, "session-state", sdk, "events.jsonl") : null;
    if (logPath === null || !existsSync(logPath)) {
      out.logCheck.noLog += 1;
      continue;
    }
    if (now - statSync(logPath).mtimeMs < LIVE_MS || now - statSync(realStore).mtimeMs < LIVE_MS) {
      out.logCheck.live += 1;
      continue;
    }
    out.stableFiles.push(logPath);
    const fromLog = eventLogCredits(parseJsonl(readFileSync(logPath, "utf-8")));
    if (fromLog === null) out.logCheck.withoutRecords += 1;
    else if (session.billed === null) out.logCheck.unknownInStore += 1;
    else if (Math.abs(fromLog - session.billed) <= 1e-9 * Math.max(1, session.billed)) out.logCheck.agree += 1;
    else out.logCheck.differ.push(`${tag(id)} store ${round(session.billed)} log ${round(fromLog)}`);
  }
  return out;
}

// ---- read-only fingerprint ----------------------------------------------------------

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      const full = path.join(current, name);
      if (lstatSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

// The settings folder by content; the Copilot logs by size and time (a live
// VS Code may write elsewhere in the same trees, so only stable files count).
function fingerprint(settingsDir: string, stableFiles: readonly string[]): string {
  const lines = [`${settingsDir}|${isDir(settingsDir) ? "present" : "absent"}`];
  for (const file of listFiles(settingsDir)) lines.push(`${file}|${sha256(readFileSync(file))}`);
  for (const file of stableFiles) {
    const s = statSync(file);
    lines.push(`${file}|${s.size}|${s.mtimeMs}`);
  }
  return lines.join("\n");
}

// ---- comparing an answer with the oracle -----------------------------------------------

function compare(where: string, answer: MonthlyAllowanceAnswer, oracle: OracleAllowance, period: OraclePeriod & { daysLeft: number; dayOfPeriod: number }, resetDay: number, variant: string | null): string[] {
  const problems: string[] = [];
  const check = (what: string, actual: unknown, expected: unknown) => {
    if (!isDeepStrictEqual(actual, expected)) problems.push(`${where} ${what}: product ${JSON.stringify(actual)} vs oracle ${JSON.stringify(expected)}`);
  };
  check("settings", answer.settings, { aiCredits: TEST_ALLOWANCE, resetDay, warnAtPercent: WARN_AT_PERCENT });
  check("period", answer.period, { startKey: period.startKey, endKeyExclusive: period.endKeyExclusive, timeZone: TIME_ZONE, daysLeft: period.daysLeft, dayOfPeriod: period.dayOfPeriod });
  check("source", { available: answer.source.available, variant: answer.source.variant }, { available: true, variant });
  check("state", answer.state, oracle.state);
  const figures = answer.figures;
  check("coverage", figures?.coverage, { known: oracle.known, total: oracle.total });
  if (oracle.state !== "no-sessions") check("countedSinceKey", figures?.countedSinceKey, oracle.countedSinceKey);
  const used = figures && "used" in figures ? figures.used : null;
  if (figures && "used" in figures) {
    if (figures.used === 0 && figures.coverage.known === 0) problems.push(`${where}: used 0 with no known session`);
    check("atLeast", figures.atLeast, oracle.atLeast);
  }
  if ((used === null) !== (oracle.used === null) || (used !== null && oracle.used !== null && !near(used, oracle.used))) problems.push(`${where} used: product ${round(used)} vs oracle ${round(oracle.used)}`);
  check(
    "byHarness",
    answer.source.byHarness.map((h) => [h.harness, h.known, h.total]),
    oracle.byHarness.map((h) => [h.harness, h.known, h.total]),
  );
  for (const h of oracle.byHarness) {
    const product = answer.source.byHarness.find((p) => p.harness === h.harness);
    if (!product) continue;
    if ((product.used === null) !== (h.used === null) || (product.used !== null && h.used !== null && !near(product.used, h.used))) problems.push(`${where} ${h.harness} used: product ${round(product.used)} vs oracle ${round(h.used)}`);
  }
  return problems;
}

// Every string in an answer, so an id, path or title can't hide in one.
const textOf = (value: unknown): string => JSON.stringify(value);

(skipReason === null ? describe : describe.skip)(`MS10 exit criterion: monthly allowance, real data${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  const startedAt = Date.now();
  const ownerSettingsDir = resolveAppSettingsDir();
  const variant = USER_DATA ? (VARIANT_LABELS[path.basename(USER_DATA)] ?? null) : null;

  let tmpRoot = "";
  let settingsDir = "";
  let before = "";
  let stableFiles: string[] = [];
  let view: LogView;
  let classic: ClassicRead;
  let host: AgentHostRead;
  let sessions: OracleSession[] = [];
  let app: Express;
  let mcp: Client;
  let clock = new Date(startedAt);
  const answers: { where: string; http: MonthlyAllowanceAnswer; mcp: MonthlyAllowanceAnswer; text: string }[] = [];

  beforeAll(async () => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "allowance-exit-"));
    settingsDir = path.join(tmpRoot, "settings");
    if (isDir(ownerSettingsDir)) cpSync(ownerSettingsDir, settingsDir, { recursive: true });
    else mkdirSync(settingsDir);
    // Named as the real one, so the answer's variant label is the real one's.
    const snapshot = path.join(tmpRoot, path.basename(USER_DATA!));

    view = buildLogView(USER_DATA!, snapshot, startedAt);
    const realStore = path.join(USER_DATA!, "User", "globalStorage", "github.copilot-chat", "session-store.db");
    const store = path.join(snapshot, "User", "globalStorage", "github.copilot-chat", "session-store.db");
    snapshotDb(realStore, store);
    host = readAgentHost(USER_DATA!, snapshot, startedAt);
    stableFiles = [...view.stableFiles, ...host.stableFiles, ...(existsSync(realStore) && startedAt - statSync(realStore).mtimeMs >= LIVE_MS ? [realStore] : [])];
    before = fingerprint(ownerSettingsDir, stableFiles);

    classic = readClassic(store, view.roots);
    sessions = [...classic.sessions, ...host.sessions];

    // The products, composed as the app composes them, over the frozen copy.
    const composition: LogProviderCompositionOptions = {
      appSettingsDir: settingsDir,
      vscodeSettingsPath: null,
      sessionStoreDbPath: store,
      debugLogsDirPaths: view.roots,
      agentTracesDbPath: null,
      agentHostUserDataDir: snapshot,
      copilotHome: COPILOT_HOME,
      claudeCodeProjectsDirPath: null,
      piAgentSessionsDirPath: null,
      mitmproxyCapturesDirPath: null,
      systemPromptLogPath: null,
    };
    const now = () => clock;
    app = createApp({ ...composition, now, timeZone: TIME_ZONE });
    const factory = createStandaloneMcpServerFactory({ ...composition, now, log: () => {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    mcp = new Client({ name: "allowance-real-data", version: "1.0.0" });
    await Promise.all([factory.createServer().connect(serverTransport), mcp.connect(clientTransport)]);
  }, 600_000);

  afterAll(async () => {
    await mcp?.close();
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    console.log(["", "MS10 exit-criterion summary (automated check, C9)", ...summary].join("\n"));
  });

  it("reports the machine, the sources and the start source", () => {
    const reasons = (harness: OracleSession["harness"]) => {
      const counts = new Map<string, number>();
      for (const s of sessions) if (s.harness === harness && s.unknownBecause) counts.set(s.unknownBecause, (counts.get(s.unknownBecause) ?? 0) + 1);
      return [...counts.entries()].map(([reason, n]) => `${reason} ${n}`).join(", ") || "none";
    };
    const local = classic.sessions;
    say(`machine: zone ${TIME_ZONE}, ${variant ?? "unnamed variant"}, today ${dayKeyIn(startedAt, TIME_ZONE)}; reset days ${RESET_DAYS.join(" and ")}; test allowance ${TEST_ALLOWANCE} AI Credits in a temporary settings copy`);
    say(`Copilot Chat (classic store): ${classic.rows} rows, ${local.length} in scope (${classic.outOfScope} out of the §18.2 scope); ${local.filter((s) => s.billed !== null).length} known; unknown: ${reasons("local")}`);
    say(`  debug logs: ${view.folders} stable session folders in the view, ${view.live} live folders left out; ${classic.logOnly.folders} with a main.jsonl and no store row (in no period), ${classic.logOnly.withCredits} of them with billed AI Credits`);
    say(`Agent Host (catalog): ${host.rows} Copilot CLI rows (by URI scheme: ${[...host.rowsByScheme].map(([scheme, n]) => `${scheme} ${n}`).join(", ")}; ${host.noId} without a usable id), ${host.tombstoned} deleted, ${host.neverSent} never sent, ${host.sessions.length} sessions (${host.stores} session.db files); ${host.sessions.filter((s) => s.billed !== null).length} known; unknown: ${reasons("agent-host")}`);
    say(`  sessions under a scheme other than ${PRODUCT_SCHEME}:/ (the product's catalog reader takes only that one): ${host.otherScheme.size}, ${host.sessions.filter((s) => host.otherScheme.has(s.id) && s.billed !== null).length} known`);
    say(`start source: classic, the store's created_at; Agent Host, the catalog's start_time; zone ${TIME_ZONE}`);
    say(`  classic sessions whose first logged event falls on another day than created_at: ${classic.edges.length}${classic.edges.length ? ` (${classic.edges.map((e) => `${tag(e.id)} created ${e.createdKey} log ${e.firstLogKey}`).join("; ")})` : ""}`);
    say(`  sessions without a readable start (in no period): ${sessions.filter((s) => s.startMs === null).length}`);
    expect(sessions.length, "no Copilot session on this machine").toBeGreaterThan(0);
  });

  it("the Copilot CLI's event logs bill each Agent Host session as session.db does, where they record usage", () => {
    const c = host.logCheck;
    say(`Agent Host bill cross-check (events.jsonl usage records vs session.db): ${c.agree} agree, ${c.differ.length} differ, ${c.withoutRecords} logs without usage records, ${c.unknownInStore} unknown in session.db, ${c.noLog} without a log, ${c.live} live left out`);
    expect(c.differ).toEqual([]);
  });

  for (const resetDay of RESET_DAYS) {
    it(`reset day ${resetDay}: PUT /api/config/monthly-allowance writes the test allowance into the temporary settings copy`, async () => {
      clock = new Date(startedAt);
      const response = await request(app).put("/api/config/monthly-allowance").send({ aiCredits: TEST_ALLOWANCE, resetDay, warnAtPercent: WARN_AT_PERCENT });
      expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
      // The oracle's reset day is the one in the settings file.
      const written = JSON.parse(readFileSync(path.join(settingsDir, "settings.json"), "utf-8")) as { monthlyAllowance?: { aiCredits?: unknown; resetDay?: unknown } };
      expect(written.monthlyAllowance).toMatchObject({ aiCredits: TEST_ALLOWANCE, resetDay });
    });

    for (const back of PERIODS_BACK) {
      const label = back === 0 ? "the current period" : `${back} period${back === 1 ? "" : "s"} back`;
      it(`reset day ${resetDay}, ${label}: used, coverage, state and the by-harness split equal the oracle's`, async () => {
        const settings = JSON.parse(readFileSync(path.join(settingsDir, "settings.json"), "utf-8")) as { monthlyAllowance: { resetDay: number } };
        const settingsResetDay = settings.monthlyAllowance.resetDay;
        const current = periodBack(dayKeyIn(startedAt, TIME_ZONE), settingsResetDay, 0);
        const period = periodBack(dayKeyIn(startedAt, TIME_ZONE), settingsResetDay, back);
        clock = new Date(back === 0 ? startedAt : instantInside(period));
        const todayKey = dayKeyIn(clock.getTime(), TIME_ZONE);
        expect(todayKey >= period.startKey && todayKey < period.endKeyExclusive, "the clock lies inside the period").toBe(true);
        if (back > 0) expect(period.endKeyExclusive <= current.startKey, "a previous period is a full one").toBe(true);

        const http = await request(app).get("/api/monthly-allowance");
        expect(http.status).toBe(200);
        const fromHttp = monthlyAllowanceAnswerSchema.parse(http.body);
        const result = await mcp.callTool({ name: "get_monthly_allowance", arguments: {} });
        expect(result.isError, JSON.stringify(result.content).slice(0, 300)).toBeFalsy();
        const fromMcp = monthlyAllowanceAnswerSchema.parse(result.structuredContent);
        const where = `reset ${settingsResetDay} ${period.startKey}..${period.endKeyExclusive}`;
        answers.push({ where, http: fromHttp, mcp: fromMcp, text: `${http.text}\n${textOf(result.content)}` });

        const oracle = allowanceIn(sessions, period, TIME_ZONE);
        const problems = compare(where, fromHttp, oracle, { ...period, daysLeft: daysBetween(todayKey, period.endKeyExclusive), dayOfPeriod: daysBetween(period.startKey, todayKey) + 1 }, resetDay, variant);
        const split = oracle.byHarness.map((h) => `${h.harness} ${h.known}/${h.total} ${round(h.used)}`).join(", ") || "none";
        const productUsed = fromHttp.figures && "used" in fromHttp.figures ? fromHttp.figures.used : null;
        say(`${where} (${label}): oracle ${oracle.state}, ${oracle.known}/${oracle.total} known, used ${round(oracle.used)} [${split}]; product ${fromHttp.state}, ${fromHttp.figures?.coverage.known ?? "-"}/${fromHttp.figures?.coverage.total ?? "-"}, used ${round(productUsed)}; ${problems.length} differences`);
        for (const problem of problems) say(`  ${problem}`);
        const other = allowanceIn(
          sessions.filter((s) => host.otherScheme.has(s.id)),
          period,
          TIME_ZONE,
        );
        if (other.total > 0) say(`  of the oracle's: ${other.total} Agent Host sessions under another URI scheme than ${PRODUCT_SCHEME}:/, ${other.known} known, ${round(other.used)} AI Credits`);
        expect(problems).toEqual([]);
      }, 600_000);
    }
  }

  it("GET /api/monthly-allowance and get_monthly_allowance answer the same in every period", () => {
    const differ = answers.filter((a) => !isDeepStrictEqual(a.http, a.mcp)).map((a) => a.where);
    say(`HTTP and MCP answers: ${answers.length - differ.length} of ${answers.length} equal`);
    expect(answers.length).toBe(RESET_DAYS.length * PERIODS_BACK.length);
    expect(differ).toEqual([]);
  });

  it("puts no session id, path or title in any answer", () => {
    const needles = [...sessions.map((s) => s.id), ...host.sdkIds, HOME, ...classic.titles.filter((t) => t.length >= 12)];
    const leaks = answers.filter((a) => needles.some((needle) => a.text.includes(needle))).map((a) => a.where);
    say(`privacy: ${answers.length} answers searched for ${needles.length} ids, paths and titles; ${leaks.length} with a match`);
    expect(leaks).toEqual([]);
  });

  it("left the Copilot logs and the owner's settings folder untouched (read-only)", () => {
    const after = fingerprint(ownerSettingsDir, stableFiles);
    say(`read-only: ${stableFiles.length} stable log and store files and the app settings folder ${after === before ? "unchanged" : "CHANGED"}`);
    expect(after === before, "a file changed").toBe(true);
  });
});
