// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Phase 15's exit criterion as an automated check (docs/plans/cost-by-
// repository-and-project.md §15, 1.0 criterion C4), over this machine's own
// logs. Opt-in and local only:
//
//   npm run test:real-data:cost-by-project
//   REAL_DATA_USER_DATA="<dir>"   (default: the VS Code user-data dir the app picks)
//
// Expected figures come from cost-by-project-oracle.mts: it reads the raw logs
// (Claude Code and pi JSONL, the Copilot Chat session store's rows and debug
// logs, VS Code's Agent Host catalog and session stores with the Copilot CLI's
// event logs), the projects file this check writes and the bundled price-book JSON,
// and shares no code with the cost cube, the pricer or the repository resolver.
// Actual figures come from the standalone app's ApiService (what the Dashboard
// calls) and its MCP server, composed as the app composes them.
//
// The owner's own settings are never touched: the products run with a
// temporary settings folder holding a projects file this check writes (two
// projects over the repositories with the most turns), and that folder also
// receives the statement this check issues. Claude Code and pi are read
// through a view of their stable files (a file written in the last 15 minutes
// is a live session, left out and counted). Copilot's stores are read in
// place; files of theirs written in the last 15 minutes are counted.
//
// pi is in scope of §15, but Phase 11 hasn't pinned its provider yet: its
// figures are checked in their own test, so its result reads apart, and the
// release procedure reruns this check after Phase 11.
//
// Output carries counts, months, rounded totals and hashed repository and
// session ids, never a prompt, title, path or file content. Read-only.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  costComparisonSchema,
  costSeriesSchema,
  costVarianceSchema,
  priceChangeListSchema,
  projectCostSchema,
  repositoryListSchema,
  statementAnswerSchema,
  type CostSeries,
  type CostTotal,
} from "@agent-cost-analyzer/domain";
import { composeLogProviders, type LogProviderCompositionOptions } from "../src/composition/compose-log-providers.js";
import { createStandalonePriceBook } from "../src/composition/create-price-book.js";
import { createStandaloneApiService } from "../src/composition/create-standalone-api-service.js";
import { createStandaloneAttribution } from "../src/composition/create-standalone-attribution.js";
import { createTurnPricer } from "../src/composition/create-turn-pricer.js";
import { createMcpServices } from "../src/composition/mcp-services.js";
import { FileStatementStore } from "../src/data-sources/statements/file-statement-store.js";
import { loadVendorProfiles } from "../src/data-sources/vendor-profiles/loader.js";
import { createMcpServer } from "../src/mcp/mcp-server.js";
import { resolveAppSettingsDir } from "../src/platform/app-settings-dir/resolve-app-settings-dir.js";
import { resolveUserDataDir } from "../src/platform/vscode-paths/resolve-user-data-dir.js";
import type { ApiService } from "../src/services/api/api-service.js";
import { priceBookHashOf } from "../src/services/billing/statement-service.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../src/test-support/vendor-profiles-dir.js";
import {
  BASES,
  addTurn,
  agentHostCatalogSessions,
  agentHostTurns,
  claudeCodeTurns,
  copilotClassicTurns,
  inChatPanelScope,
  emptyCell,
  figuresOf,
  loadBook,
  monthOf,
  piLeafCount,
  piTurns,
  pricePart,
  projectOf,
  redactKey,
  repositoryKeyOf,
  type Basis,
  type AgentHostStoreTurn,
  type BookVersion,
  type Cell,
  type Currency,
  type OracleProject,
  type OracleTurn,
  type StoreSession,
  type StoreTurn,
} from "./cost-by-project-oracle.mjs";
import { parseJsonl } from "./savings-oracle.mjs";

const REAL_DATA = process.env.REAL_DATA === "1";
const HOME = homedir();
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");
const PI_SESSIONS = path.join(HOME, ".pi", "agent", "sessions");
const USER_DATA = process.env.REAL_DATA_USER_DATA?.trim() || resolveUserDataDir();
const PRICE_BOOK_DIR = path.join(FIXTURE_VENDOR_PROFILES_DIR, "..", "price-book");

// Both sides are deterministic sums over the same figures: only the order of
// floating-point additions may differ. A relative 1e-9 (absolute below 1).
const TOLERANCE = 1e-9;
const LIVE_MS = 15 * 60_000;
const SINCE = "2026-01-01";
const UNTIL = new Date().toISOString().slice(0, 10);
const LIMIT = 500; // the most a request may ask for, per provider
const PROJECT_A = "project-a";
const PROJECT_B = "project-b";
const CURRENCIES: readonly Currency[] = ["AI_CREDITS", "USD"];
// The Copilot CLI's home, resolved as the CLI does (COPILOT_HOME, else ~/.copilot).
const COPILOT_HOME = process.env.COPILOT_HOME?.trim() ? process.env.COPILOT_HOME : path.join(HOME, ".copilot");

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const skipReason = !REAL_DATA ? "set REAL_DATA=1 to run" : !isDir(CLAUDE_PROJECTS) && !isDir(PI_SESSIONS) && USER_DATA === null ? "no agent logs on this machine" : null;

const near = (actual: number, expected: number) => Math.abs(actual - expected) <= TOLERANCE * Math.max(1, Math.abs(expected));
// A statement rounds its totals to 1e-9 (domain statement.ts), so its sums are
// compared to a millionth of a unit, far below the cent it bills in.
const nearStatement = (actual: number, expected: number) => Math.abs(actual - expected) <= 1e-6 * Math.max(1, Math.abs(expected));
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const tag = (s: string) => sha256(s).slice(0, 8);
const round = (n: number | undefined) => (n === undefined ? "-" : n.toFixed(2));

const summary: string[] = [];
const say = (line: string) => summary.push(line);

// ---- the stable view of a JSONL tree (<root>/<folder>/<file>.jsonl) --------

interface View {
  dir: string;
  files: string[]; // links in the view
  targets: string[];
  live: number;
}

function buildView(source: string, dir: string, now: number): View {
  const view: View = { dir, files: [], targets: [], live: 0 };
  mkdirSync(dir, { recursive: true });
  if (!isDir(source)) return view;
  for (const folder of readdirSync(source).sort()) {
    const folderPath = path.join(source, folder);
    if (!isDir(folderPath)) continue;
    for (const name of readdirSync(folderPath).sort()) {
      const target = path.join(folderPath, name);
      if (!name.toLowerCase().endsWith(".jsonl") || !statSync(target).isFile()) continue;
      if (now - statSync(target).mtimeMs < LIVE_MS) {
        view.live += 1;
        continue;
      }
      mkdirSync(path.join(dir, folder), { recursive: true });
      const link = path.join(dir, folder, name);
      symlinkSync(target, link);
      view.files.push(link);
      view.targets.push(target);
    }
  }
  return view;
}

// ---- Copilot Chat's classic store, read raw ---------------------------------

// The store's sessions of interactive chat: plan §15.2 selects them by surface
// (host type 'vscode', or agent_name 'GitHub Copilot Chat'); other surfaces have
// other billing profiles. The rest are counted, not compared.

interface CopilotRaw {
  sessions: { session: StoreSession; inScope: boolean; turns: StoreTurn[]; mainPath: string | null }[];
  logFiles: string[];
  live: number;
}

function debugLogRoots(userData: string): string[] {
  const roots = [path.join(userData, "User", "globalStorage", "github.copilot-chat", "debug-logs")];
  const ws = path.join(userData, "User", "workspaceStorage");
  if (isDir(ws)) for (const hash of readdirSync(ws).sort()) roots.push(path.join(ws, hash, "GitHub.copilot-chat", "debug-logs"));
  return roots.filter(isDir);
}

function readCopilotRaw(userData: string | null, now: number): CopilotRaw {
  const out: CopilotRaw = { sessions: [], logFiles: [], live: 0 };
  if (userData === null) return out;
  const dbPath = path.join(userData, "User", "globalStorage", "github.copilot-chat", "session-store.db");
  if (!existsSync(dbPath)) return out;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const sessions = db.prepare("SELECT id, cwd, repository, created_at, agent_name, host_type FROM sessions").all() as unknown as (StoreSession & { agent_name: string | null; host_type: string | null })[];
    const turns = db.prepare("SELECT session_id, turn_index, user_message, timestamp FROM turns").all() as unknown as (StoreTurn & { session_id: string })[];
    const roots = debugLogRoots(userData);
    for (const session of sessions) {
      const dir = roots.map((root) => path.join(root, session.id)).find((candidate) => existsSync(path.join(candidate, "main.jsonl")));
      const mainPath = dir ? path.join(dir, "main.jsonl") : null;
      if (dir) {
        for (const name of readdirSync(dir)) {
          const file = path.join(dir, name);
          if (!name.endsWith(".jsonl")) continue;
          if (now - statSync(file).mtimeMs < LIVE_MS) out.live += 1;
          else out.logFiles.push(file);
        }
      }
      const { agent_name: agent, host_type: host, ...row } = session;
      out.sessions.push({ session: row, inScope: inChatPanelScope({ host_type: host, agent_name: agent }), turns: turns.filter((t) => t.session_id === session.id), mainPath });
    }
  } finally {
    db.close();
  }
  return out;
}

function copilotTurnsOf(raw: CopilotRaw["sessions"][number]): ReturnType<typeof copilotClassicTurns> {
  const dir = raw.mainPath ? path.dirname(raw.mainPath) : null;
  const subagentFiles = dir
    ? readdirSync(dir)
        .filter((name) => (name.startsWith("runSubagent-") || name.startsWith("searchSubagent-")) && name.endsWith(".jsonl"))
        .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf-8") }))
    : [];
  return copilotClassicTurns({ session: raw.session, storeTurns: raw.turns, mainText: raw.mainPath ? readFileSync(raw.mainPath, "utf-8") : null, subagentFiles });
}

// ---- VS Code's Agent Host, read raw -------------------------------------------
// The catalog (User/globalStorage/agent-host.db; its sessions under either
// URI scheme, agentHostCatalogSessions), each session's
// agentSessionData/<id>/session.db and the Copilot CLI's event log, all
// opened read-only.

interface AgentHostRaw {
  sessions: ReturnType<typeof agentHostTurns>[];
  files: string[]; // stable stores and logs, for the fingerprint
  live: number;
}

function jsonRecord(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function localFolder(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri.startsWith("file:")) return null;
  try {
    return fileURLToPath(uri) || null;
  } catch {
    return null;
  }
}

function readAgentHostRaw(userData: string | null, now: number): AgentHostRaw {
  const out: AgentHostRaw = { sessions: [], files: [], live: 0 };
  const catalogPath = userData ? path.join(userData, "User", "globalStorage", "agent-host.db") : null;
  if (catalogPath === null || !existsSync(catalogPath)) return out;
  const note = (file: string) => {
    if (!existsSync(file)) return;
    if (now - statSync(file).mtimeMs < LIVE_MS) out.live += 1;
    else out.files.push(file);
  };
  const catalog = new DatabaseSync(catalogPath, { readOnly: true });
  try {
    const tombstones = new Set((catalog.prepare("SELECT key FROM metadata WHERE value = 'true'").all() as unknown as { key: string }[]).map((r) => r.key));
    const rows = catalog.prepare("SELECT session_uri, payload, start_time FROM sessions_v2 WHERE provider = 'copilotcli'").all() as unknown as { session_uri: string; payload: string | null; start_time: number }[];
    const chats = catalog.prepare("SELECT owner_session_uri, provider_data FROM chats_v2 ORDER BY chat_order IS NULL, chat_order, rowid").all() as unknown as { owner_session_uri: string; provider_data: unknown }[];
    for (const { id, row } of agentHostCatalogSessions(rows, tombstones)) {
      const storePath = path.join(userData!, "agentSessionData", id, "session.db");
      if (!existsSync(storePath)) continue; // no turns to count
      note(storePath);
      const store = new DatabaseSync(storePath, { readOnly: true });
      let storeTurns: AgentHostStoreTurn[];
      try {
        const columns = (store.prepare("PRAGMA table_info(turns)").all() as unknown as { name: string }[]).map((c) => c.name);
        if (columns.length === 0) continue;
        const hasUsage = (store.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'turn_usage'").all() as unknown[]).length > 0;
        const eventId = columns.includes("event_id") ? "t.event_id" : "NULL";
        storeTurns = store
          .prepare(`SELECT t.id AS id, ${eventId} AS event_id, ${hasUsage ? "u.usage" : "NULL"} AS usage FROM turns AS t ${hasUsage ? "LEFT JOIN turn_usage AS u ON u.turn_id = t.id" : ""} ORDER BY t.rowid`)
          .all() as unknown as AgentHostStoreTurn[];
      } finally {
        store.close();
      }
      if (storeTurns.length === 0) continue; // a chat opened but never sent
      const data = jsonRecord(row.payload)?.data;
      const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
      const project = typeof record.project === "object" && record.project !== null ? (record.project as Record<string, unknown>) : {};
      const folder = localFolder(project.uri) ?? (Array.isArray(record.workingDirectories) ? localFolder(record.workingDirectories[0]) : null);
      const sdk = chats.filter((c) => c.owner_session_uri === row.session_uri).map((c) => jsonRecord(c.provider_data)?.sdkSessionId).find((s): s is string => typeof s === "string" && /^[0-9A-Za-z][0-9A-Za-z-]*$/.test(s));
      const logPath = sdk ? path.join(COPILOT_HOME, "session-state", sdk, "events.jsonl") : null;
      const events = logPath && existsSync(logPath) ? parseJsonl(readFileSync(logPath, "utf-8")) : null;
      if (logPath) note(logPath);
      out.sessions.push(agentHostTurns({ session: { id, startedAt: new Date(row.start_time).toISOString(), folder }, storeTurns, events }));
    }
  } finally {
    catalog.close();
  }
  return out;
}

// ---- the oracle's turns, attributed -----------------------------------------

interface Attributed {
  turn: OracleTurn;
  key: string | null; // full repository key; null: unattributed
  month: string | null;
}

const inWindow = (start: string | null) => start !== null && start.slice(0, 10) >= SINCE && start.slice(0, 10) <= UNTIL;

// ---- read-only fingerprint ----------------------------------------------------

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

function fingerprint(contentFiles: string[], configDirs: string[], stableFiles: string[]): string {
  const lines: string[] = [];
  for (const file of contentFiles) lines.push(`${file}|${existsSync(file) ? sha256(readFileSync(file)) : "absent"}`);
  for (const dir of configDirs) {
    lines.push(`${dir}|${isDir(dir) ? "present" : "absent"}`);
    for (const file of listFiles(dir)) lines.push(`${file}|${sha256(readFileSync(file))}`);
  }
  for (const file of stableFiles) {
    const s = statSync(file);
    lines.push(`${file}|${s.size}|${s.mtimeMs}`);
  }
  return lines.join("\n");
}

// ---- comparing a product total with an oracle cell --------------------------

function compareTotal(where: string, total: CostTotal, cell: Cell, basis: Basis, problems: string[]): void {
  const sum = cell.basis[basis];
  if (total.turns !== cell.turns) problems.push(`${where}: turns ${total.turns} vs oracle ${cell.turns}`);
  if (total.knownTurns !== sum.knownTurns) problems.push(`${where}: ${basis} known turns ${total.knownTurns} vs oracle ${sum.knownTurns}`);
  for (const currency of CURRENCIES) {
    const actual = total.amounts.find((a) => a.currency === currency);
    const expected = sum.amounts[currency];
    if (expected === undefined && actual !== undefined) problems.push(`${where}: ${basis} ${currency} ${round(actual.amount)} where the oracle has none`);
    else if (expected !== undefined && actual === undefined) problems.push(`${where}: ${basis} ${currency} missing, oracle ${round(expected)}`);
    else if (expected !== undefined && actual !== undefined && !near(actual.amount, expected)) problems.push(`${where}: ${basis} ${currency} ${actual.amount} vs oracle ${expected}`);
  }
}

// Every total anywhere in an answer: unknown is never 0, coverage never over.
function checkTotals(where: string, value: unknown, problems: string[]): number {
  let seen = 0;
  const walk = (node: unknown, at: string) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${at}[${i}]`));
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    if (typeof record.turns === "number" && typeof record.knownTurns === "number" && Array.isArray(record.amounts)) {
      seen += 1;
      const total = record as unknown as CostTotal;
      if (total.knownTurns > total.turns) problems.push(`${where}${at}: knownTurns ${total.knownTurns} > turns ${total.turns}`);
      if (total.knownTurns === 0 && (total.amounts.length > 0 || total.usd !== null)) problems.push(`${where}${at}: nothing known but an amount (${JSON.stringify(total.amounts)}, usd ${total.usd})`);
      for (const amount of total.amounts) if (amount.knownTurns === 0) problems.push(`${where}${at}: a ${amount.currency} amount over no known turn`);
    }
    for (const [k, child] of Object.entries(record)) walk(child, `${at}.${k}`);
  };
  walk(value, "");
  return seen;
}

function mergeTotals(totals: readonly CostTotal[]): CostTotal {
  const amounts = CURRENCIES.flatMap((currency) => {
    const of = totals.flatMap((t) => t.amounts.filter((a) => a.currency === currency));
    return of.length === 0 ? [] : [{ currency, amount: of.reduce((s, a) => s + a.amount, 0), knownTurns: of.reduce((s, a) => s + a.knownTurns, 0) }];
  });
  const usd = totals.some((t) => t.usd !== null) ? totals.reduce((s, t) => s + (t.usd ?? 0), 0) : null;
  return { ...totals[0]!, turns: totals.reduce((s, t) => s + t.turns, 0), knownTurns: totals.reduce((s, t) => s + t.knownTurns, 0), amounts, usd };
}

function mergeLines(lines: CostSeries["series"]): CostSeries["series"][number] {
  const periods = [...new Set(lines.flatMap((l) => l.points.map((p) => p.period)))].sort();
  return {
    ...lines[0]!,
    sessions: lines.reduce((s, l) => s + l.sessions, 0),
    turns: lines.reduce((s, l) => s + l.turns, 0),
    total: mergeTotals(lines.map((l) => l.total)),
    points: periods.map((period) => {
      const points = lines.flatMap((l) => l.points.filter((p) => p.period === period));
      return { ...points[0]!, turns: points.reduce((s, p) => s + p.turns, 0), cost: mergeTotals(points.map((p) => p.cost)) };
    }),
  };
}

// Every string in an answer with its dotted path (array indexes as numbers).
function stringsOf(value: unknown, at = "", out: { at: string; text: string }[] = []): { at: string; text: string }[] {
  if (typeof value === "string") out.push({ at, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => stringsOf(v, `${at}.${i}`, out));
  else if (typeof value === "object" && value !== null) for (const [k, v] of Object.entries(value)) stringsOf(v, `${at}.${k}`, out);
  return out;
}

// A statement's session titles (plan §8.5, threat model: statements hold
// session ids and titles). A title is the source's own: VS Code's Agent Host
// titles some sessions with their first prompt's opening, so titles are
// counted apart, for the owner, instead of failing the check.
const SESSION_TITLE_AT = /\.provenance\.sessions\.\d+\.title$/;

(skipReason === null ? describe : describe.skip)(`Phase 15 exit criterion: cost by repository and project, real data${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  const startedAt = Date.now();
  const ownerSettingsDir = resolveAppSettingsDir();
  const contentFiles = [path.join(HOME, ".claude.json"), ...(USER_DATA ? [path.join(USER_DATA, "User", "settings.json")] : [])];
  const book: BookVersion[] = loadBook(PRICE_BOOK_DIR);

  let tmpRoot = "";
  let settingsDir = "";
  let before = "";
  let stableFiles: string[] = [];
  let claudeView: View;
  let piView: View;
  let copilotRaw: CopilotRaw;
  let agentHostRaw: AgentHostRaw;
  let api: ApiService;
  let mcp: Client;
  const attributed: Attributed[] = [];
  const prompts: string[] = [];
  let projects: OracleProject[] = [];
  let piForkedFiles = 0;
  const mcpAnswers: { tool: string; value: unknown; text: string }[] = [];
  const productAnswers: { where: string; value: unknown }[] = [];
  const counts = { claude: { sessions: 0, turns: 0 }, pi: { sessions: 0, turns: 0 }, copilot: { sessions: 0, turns: 0 }, agentHost: { sessions: 0, turns: 0 } };
  const otherAgents = { sessions: 0, turns: 0, credits: 0 };

  const projectFileOf = (extra: object = {}) => ({
    version: 1,
    projects: [
      { id: PROJECT_A, name: "Project A", members: projects[0]!.members, includeSubscriptionUse: true },
      { id: PROJECT_B, name: "Project B", members: projects[1]!.members },
    ],
    aliases: {},
    captureRules: [],
    ...extra,
  });

  const callTool = async (name: string, args: Record<string, unknown>) => {
    const result = await mcp.callTool({ name, arguments: args });
    const text = JSON.stringify(result.content);
    expect(result.isError, `${name}: ${text.slice(0, 300)}`).toBeFalsy();
    mcpAnswers.push({ tool: name, value: result.structuredContent, text });
    return result.structuredContent;
  };

  // The oracle's cells: per (key, month), filtered.
  const cellsBy = (keyOf: (a: Attributed) => string | null, keep: (a: Attributed) => boolean) => {
    const cells = new Map<string, Map<string, Cell>>(); // key -> month -> cell
    const totals = new Map<string, Cell>();
    for (const a of attributed) {
      if (!keep(a) || a.month === null) continue;
      const key = keyOf(a) ?? "(none)";
      const byMonth = cells.get(key) ?? new Map<string, Cell>();
      cells.set(key, byMonth);
      const cell = byMonth.get(a.month) ?? emptyCell();
      byMonth.set(a.month, cell);
      addTurn(cell, a.turn, book);
      const total = totals.get(key) ?? emptyCell();
      totals.set(key, total);
      addTurn(total, a.turn, book);
    }
    return { cells, totals };
  };
  const projectIdOf = (a: Attributed) => projectOf(a.key, projects, {});
  const seriesQuery = (basis: Basis, groupBy: "repository" | "project", provider?: string) => ({
    since: SINCE,
    until: UNTIL,
    bucket: "month",
    basis,
    currency: "native",
    groupBy,
    limit: String(LIMIT),
    ...(provider ? { provider } : {}),
  });

  // Every series line and monthly point against the oracle's cells.
  const compareSeries = (where: string, series: CostSeries, basis: Basis, cells: Map<string, Map<string, Cell>>, totals: Map<string, Cell>, problems: string[], label: (key: string) => string) => {
    const lines = new Map<string, CostSeries["series"]>();
    for (const line of series.series) lines.set(line.key ?? "(none)", [...(lines.get(line.key ?? "(none)") ?? []), line]);
    const keys = new Set([...lines.keys(), ...totals.keys()]);
    for (const key of keys) {
      const productLines = lines.get(key) ?? [];
      const total = totals.get(key);
      if (!total) {
        problems.push(`${where} ${label(key)}: product has ${productLines.reduce((s, l) => s + l.turns, 0)} turns, oracle none`);
        continue;
      }
      // Two local repositories with one folder name are two lines under one shown key.
      const line = productLines.length === 1 ? productLines[0]! : mergeLines(productLines);
      compareTotal(`${where} ${label(key)}`, line.total, total, basis, problems);
      if (line.sessions !== total.sessions.size) problems.push(`${where} ${label(key)}: sessions ${line.sessions} vs oracle ${total.sessions.size}`);
      for (const point of line.points) {
        const cell = cells.get(key)?.get(point.period);
        if (!cell) {
          if (point.turns > 0) problems.push(`${where} ${label(key)} ${point.period}: product ${point.turns} turns, oracle none`);
          continue;
        }
        compareTotal(`${where} ${label(key)} ${point.period}`, point.cost, cell, basis, problems);
      }
      for (const month of cells.get(key)?.keys() ?? []) if (!line.points.some((p) => p.period === month)) problems.push(`${where} ${label(key)} ${month}: no product point`);
    }
  };

  beforeAll(async () => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "cost-by-project-exit-"));
    settingsDir = path.join(tmpRoot, "settings");
    mkdirSync(settingsDir);
    claudeView = buildView(CLAUDE_PROJECTS, path.join(tmpRoot, "claude"), startedAt);
    piView = buildView(PI_SESSIONS, path.join(tmpRoot, "pi"), startedAt);
    copilotRaw = readCopilotRaw(USER_DATA, startedAt);
    agentHostRaw = readAgentHostRaw(USER_DATA, startedAt);
    stableFiles = [...claudeView.targets, ...piView.targets, ...copilotRaw.logFiles, ...agentHostRaw.files];
    before = fingerprint(contentFiles, [ownerSettingsDir], stableFiles);

    // ---- the oracle: every turn of every session started in the window ----
    const add = (turns: OracleTurn[], start: string | null, counter: { sessions: number; turns: number }) => {
      if (!inWindow(start)) return;
      counter.sessions += 1;
      for (const turn of turns) {
        counter.turns += 1;
        attributed.push({ turn, key: repositoryKeyOf(turn.folder, turn.recordedRepository), month: turn.at ? monthOf(turn.at) : null });
      }
    };
    for (const file of claudeView.files) {
      const read = claudeCodeTurns(readFileSync(file, "utf-8"), file);
      prompts.push(...read.prompts);
      add(read.turns, read.start, counts.claude);
    }
    for (const file of piView.files) {
      const text = readFileSync(file, "utf-8");
      if (piLeafCount(text) > 1) piForkedFiles += 1;
      const read = piTurns(text, file);
      prompts.push(...read.prompts);
      add(read.turns, read.start, counts.pi);
    }
    for (const raw of copilotRaw.sessions) {
      const read = copilotTurnsOf(raw);
      prompts.push(...read.prompts);
      if (raw.inScope) add(read.turns, raw.session.created_at, counts.copilot);
      else if (inWindow(raw.session.created_at)) {
        otherAgents.sessions += 1;
        otherAgents.turns += read.turns.length;
        otherAgents.credits += read.turns.reduce((s, t) => s + (t.billed ?? 0), 0);
      }
    }
    for (const read of agentHostRaw.sessions) {
      prompts.push(...read.prompts);
      add(read.turns, read.start, counts.agentHost);
    }

    // ---- two projects over the four busiest repositories (not pi-only) ----
    const busy = new Map<string, number>();
    for (const a of attributed) if (a.key !== null && !a.key.startsWith("path:") && a.turn.provider !== "pi-agent") busy.set(a.key, (busy.get(a.key) ?? 0) + 1);
    const top = [...busy.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([key]) => key);
    expect(top.length, "fewer than three repositories with Copilot or Claude Code turns").toBeGreaterThanOrEqual(3);
    projects = [
      { id: PROJECT_A, members: [top[0]!, ...(top[2] ? [top[2]] : [])].map((repository) => ({ repository })) },
      { id: PROJECT_B, members: [top[1]!, ...(top[3] ? [top[3]] : [])].map((repository) => ({ repository })) },
    ];
    writeFileSync(path.join(settingsDir, "projects.json"), JSON.stringify(projectFileOf(), null, 2));

    // ---- the products: Copilot Chat's classic store, Claude Code and pi ----
    const composition: LogProviderCompositionOptions = {
      appSettingsDir: settingsDir,
      vscodeSettingsPath: null,
      ...(USER_DATA
        ? {
            sessionStoreDbPath: path.join(USER_DATA, "User", "globalStorage", "github.copilot-chat", "session-store.db"),
            debugLogsDirPaths: debugLogRoots(USER_DATA),
            agentTracesDbPath: path.join(USER_DATA, "User", "globalStorage", "github.copilot-chat", "agent-traces.db"),
          }
        : { sessionStoreDbPath: path.join(tmpRoot, "no-store.db"), debugLogsDirPaths: [], agentTracesDbPath: null }),
      // VS Code's Agent Host and the Copilot CLI's event logs, as the app finds them.
      agentHostUserDataDir: USER_DATA,
      copilotHome: COPILOT_HOME,
      claudeCodeProjectsDirPath: claudeView.dir,
      piAgentSessionsDirPath: piView.dir,
      mitmproxyCapturesDirPath: null,
      systemPromptLogPath: null,
    };
    const common = {
      vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR,
      appVersion: "0.0.0-real-data",
      learnScriptsDir: path.join(FIXTURE_VENDOR_PROFILES_DIR, "..", "learn-scripts"),
      timeZone: "UTC",
    };
    api = createStandaloneApiService({ ...composition, ...common });
    // The MCP server as mcp/stdio.ts composes it, over the same folders.
    const { registry } = composeLogProviders(composition);
    const vendorProfiles = loadVendorProfiles(FIXTURE_VENDOR_PROFILES_DIR);
    const attribution = createStandaloneAttribution(registry, settingsDir, vendorProfiles);
    const priceBook = createStandalonePriceBook(settingsDir, attribution.catalog);
    const server = createMcpServer({
      ...createMcpServices(
        registry,
        "0.0.0-real-data",
        undefined,
        attribution,
        createTurnPricer(priceBook),
        priceBook,
        { store: new FileStatementStore(settingsDir), projects: attribution.catalog, priceBookHash: () => priceBookHashOf(priceBook.list({}).versions), timeZone: "UTC" },
        { profiles: vendorProfiles, priceBook },
      ),
      priceBook,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    mcp = new Client({ name: "cost-by-project-real-data", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  }, 1_800_000);

  afterAll(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    console.log(["", "Phase 15 exit-criterion summary (automated check, C4)", ...summary].join("\n"));
  });

  it("reports the machine, the window and what each side reads", () => {
    say(`window: sessions started ${SINCE}..${UNTIL} (UTC), at most ${LIMIT} per provider; months are UTC`);
    say(`Claude Code: ${counts.claude.sessions} sessions, ${counts.claude.turns} turns (${claudeView.live} live files left out)`);
    say(`pi: ${counts.pi.sessions} files, ${counts.pi.turns} turns (${piView.live} live files left out; ${piForkedFiles} files with forks)`);
    say(`Copilot Chat (classic store): ${counts.copilot.sessions} sessions, ${counts.copilot.turns} turns (${copilotRaw.live} debug-log files written in the last 15 minutes)`);
    say(`  outside every view by the §18.2 scope (store host type other than vscode and agent name other than GitHub Copilot Chat): ${otherAgents.sessions} sessions, ${otherAgents.turns} turns, ${round(otherAgents.credits)} AI Credits in their logs`);
    const hostTurns = attributed.filter((a) => a.turn.provider === "vscode" && agentHostRaw.sessions.some((s) => s.turns.includes(a.turn)));
    const hostCredits = hostTurns.reduce((s, a) => s + (a.turn.billed ?? 0), 0);
    say(`Copilot Agent Host: ${counts.agentHost.sessions} sessions, ${counts.agentHost.turns} turns, ${round(hostCredits)} AI Credits on ${hostTurns.filter((a) => typeof a.turn.billed === "number").length} turns (${agentHostRaw.live} stores or logs written in the last 15 minutes)`);
    const keys = new Set(attributed.map((a) => a.key).filter((key) => key !== null));
    say(`oracle: ${keys.size} repository keys (${attributed.filter((a) => a.key === null).length} unattributed turns); projects: A ${projects[0]!.members.length} repositories, B ${projects[1]!.members.length} (ids ${projects.flatMap((p) => p.members.map((m) => tag(m.repository))).join(", ")})`);
    expect(counts.claude.turns + counts.copilot.turns + counts.pi.turns, "no turn in the window").toBeGreaterThan(0);
    expect(projects.flatMap((p) => p.members).length, "three repositories in two projects").toBeGreaterThanOrEqual(3);
  });

  const mainProviders = ["vscode", "claude-code"] as const;
  for (const provider of mainProviders) {
    it(`${provider}: each repository's and project's cost per month, per basis and currency, equals the oracle's`, async () => {
      const problems: string[] = [];
      const keep = (a: Attributed) => a.turn.provider === provider;
      const byRepo = cellsBy((a) => (a.key === null ? null : redactKey(a.key)), keep);
      const byProject = cellsBy(projectIdOf, keep);
      for (const basis of BASES) {
        const repoSeries = costSeriesSchema.parse(await api.getCostTimeSeries(seriesQuery(basis, "repository", provider)));
        productAnswers.push({ where: `${provider} repository ${basis}`, value: repoSeries });
        expect(repoSeries.providers.filter((p) => p.truncated).map((p) => p.id), "a provider hit the session limit").toEqual([]);
        compareSeries(`${basis} repo`, repoSeries, basis, byRepo.cells, byRepo.totals, problems, tag);
        const projectSeries = costSeriesSchema.parse(await api.getCostTimeSeries(seriesQuery(basis, "project", provider)));
        productAnswers.push({ where: `${provider} project ${basis}`, value: projectSeries });
        compareSeries(`${basis} project`, projectSeries, basis, byProject.cells, byProject.totals, problems, (k) => k);
      }
      const cells = [...byRepo.cells.values()].reduce((n, m) => n + m.size, 0);
      const preferred = [...byRepo.totals.values()].reduce((acc, c) => {
        for (const cur of CURRENCIES) acc[cur] = (acc[cur] ?? 0) + (c.basis.preferred.amounts[cur] ?? 0);
        return acc;
      }, {} as Record<string, number>);
      say(`${provider}: ${byRepo.totals.size} repositories, ${cells} repository-months x 4 bases compared; preferred total ${round(preferred.AI_CREDITS)} AI Credits + ${round(preferred.USD)} USD; ${problems.length} differences`);
      for (const p of problems.slice(0, 15)) say(`  ${p}`);
      expect(problems, problems.slice(0, 20).join("\n")).toEqual([]);
    }, 1_800_000);
  }

  it("pi (reported apart, pending Phase 11): each repository's cost per month equals the oracle's", async () => {
    const problems: string[] = [];
    const keep = (a: Attributed) => a.turn.provider === "pi-agent";
    const byRepo = cellsBy((a) => (a.key === null ? null : redactKey(a.key)), keep);
    for (const basis of BASES) {
      const series = costSeriesSchema.parse(await api.getCostTimeSeries(seriesQuery(basis, "repository", "pi-agent")));
      productAnswers.push({ where: `pi repository ${basis}`, value: series });
      compareSeries(`${basis} repo`, series, basis, byRepo.cells, byRepo.totals, problems, tag);
    }
    const known = [...byRepo.totals.values()].reduce((n, c) => n + c.basis.reported.knownTurns, 0);
    const usd = [...byRepo.totals.values()].reduce((n, c) => n + (c.basis.reported.amounts.USD ?? 0), 0);
    const priced = [...byRepo.totals.values()].reduce((n, c) => n + c.basis.priced.knownTurns, 0);
    say(`pi: ${byRepo.totals.size} repositories; reported cost on ${known} turns, ${round(usd)} USD; priced on ${priced} turns; ${problems.length} differences`);
    for (const p of problems.slice(0, 10)) say(`  ${p}`);
    expect(problems, problems.slice(0, 20).join("\n")).toEqual([]);
  }, 1_800_000);

  it("every provider together: the Dashboard's project tab and MCP agree with the oracle for both projects", async () => {
    const problems: string[] = [];
    const byProject = cellsBy(projectIdOf, () => true);
    const byRepo = cellsBy((a) => (a.key === null ? null : redactKey(a.key)), () => true);
    for (const projectId of [PROJECT_A, PROJECT_B]) {
      const query = { projectId, since: SINCE, until: UNTIL, bucket: "month", limit: String(LIMIT) };
      const fromApi = projectCostSchema.parse(await api.getProjectCost(query));
      productAnswers.push({ where: `project ${projectId}`, value: fromApi });
      const fromMcp = projectCostSchema.parse(await callTool("get_project_cost", { projectId, since: SINCE, until: UNTIL, limit: LIMIT }));
      expect({ ...fromMcp, generatedAt: "" }, `${projectId}: MCP and the Dashboard differ`).toEqual({ ...fromApi, generatedAt: "" });
      const total = byProject.totals.get(projectId) ?? emptyCell();
      compareTotal(`${projectId}`, fromApi.total, total, "preferred", problems);
      for (const basis of BASES) compareTotal(`${projectId} totals`, fromApi.totals[basis === "preferred" ? "preferred" : basis], total, basis, problems);
      for (const point of fromApi.points) {
        const cell = byProject.cells.get(projectId)?.get(point.period);
        if (cell) compareTotal(`${projectId} ${point.period}`, point.cost, cell, "preferred", problems);
        else if (point.turns > 0) problems.push(`${projectId} ${point.period}: product ${point.turns} turns, oracle none`);
      }
      for (const row of fromApi.byRepository) {
        const cell = byRepo.totals.get(row.key ?? "(none)");
        if (!cell) problems.push(`${projectId} member ${tag(row.key ?? "")}: no oracle turns`);
        else compareTotal(`${projectId} member ${tag(row.key ?? "")}`, row.cost, cell, "preferred", problems);
      }
      // The vendor split adds up to the project.
      const vendorTurns = fromApi.byVendor.reduce((n, v) => n + v.turns, 0);
      if (vendorTurns < fromApi.turns) problems.push(`${projectId}: vendor rows cover ${vendorTurns} of ${fromApi.turns} turns`);
      say(`${projectId}: ${fromApi.turns} turns, ${fromApi.sessions} sessions over ${fromApi.points.filter((p) => p.turns > 0).length} months; preferred ${fromApi.total.amounts.map((a) => `${round(a.amount)} ${a.currency}`).join(" + ") || "none known"} (${fromApi.total.knownTurns}/${fromApi.total.turns} turns known); ${fromApi.byVendor.length} vendors; ${fromApi.priceChanges.length} documented price changes marked`);
    }
    // compare_costs and get_repository_cost: MCP equals the Dashboard for every member repository.
    const members = projects.flatMap((p) => p.members.map((m) => m.repository));
    const comparison = costComparisonSchema.parse(await callTool("compare_costs", { groupBy: "repository", ids: members, since: SINCE, until: UNTIL, limit: LIMIT }));
    const comparisonApi = costComparisonSchema.parse(await api.getCostComparison({ groupBy: "repository", ids: members, since: SINCE, until: UNTIL, limit: String(LIMIT) }));
    expect({ ...comparison, generatedAt: "" }, "compare_costs: MCP and the Dashboard differ").toEqual({ ...comparisonApi, generatedAt: "" });
    for (const row of comparison.rows) {
      const cell = byRepo.totals.get(row.key);
      if (cell) compareTotal(`compare ${tag(row.key)}`, row.total, cell, "preferred", problems);
      else problems.push(`compare ${tag(row.key)}: no oracle turns`);
    }
    const projectsCompared = costComparisonSchema.parse(await callTool("compare_costs", { groupBy: "project", ids: [PROJECT_A, PROJECT_B], since: SINCE, until: UNTIL, limit: LIMIT }));
    for (const row of projectsCompared.rows) compareTotal(`compare ${row.key}`, row.total, byProject.totals.get(row.key) ?? emptyCell(), "preferred", problems);
    for (const repository of members) {
      const fromMcp = costSeriesSchema.parse(await callTool("get_repository_cost", { repository, since: SINCE, until: UNTIL, limit: LIMIT }));
      const fromApi = costSeriesSchema.parse(await api.getCostTimeSeries({ groupBy: "repository", ids: repository, since: SINCE, until: UNTIL, limit: String(LIMIT) }));
      expect(fromMcp.points, `get_repository_cost ${tag(repository)}: MCP and the Dashboard differ`).toEqual(fromApi.points);
      expect(fromMcp.totals).toEqual(fromApi.totals);
    }
    // Every repository through MCP: compare_costs, 20 at a time, against the oracle by full key.
    const byFullKey = cellsBy((a) => a.key, () => true).totals;
    const keys = [...byFullKey.keys()].filter((key) => key !== "(none)").sort();
    for (let i = 0; i < keys.length; i += 20) {
      // compare_costs takes 2 to 20 ids: a lone last key goes with the one before it.
      const ids = keys.slice(i > 0 && keys.length - i === 1 ? i - 1 : i, i + 20);
      if (ids.length < 2) continue;
      const rows = costComparisonSchema.parse(await callTool("compare_costs", { groupBy: "repository", ids, since: SINCE, until: UNTIL, limit: LIMIT })).rows;
      rows.forEach((row, index) => compareTotal(`compare_costs ${tag(ids[index]!)}`, row.total, byFullKey.get(ids[index]!)!, "preferred", problems));
    }
    const listed = repositoryListSchema.parse(await callTool("list_repositories", { since: SINCE, until: UNTIL }));
    say(`MCP = Dashboard: get_project_cost x2, compare_costs (${members.length} repositories, 2 projects), get_repository_cost x${members.length}; MCP = oracle: compare_costs over all ${keys.length} repositories; list_repositories names ${listed.repositories.length} repositories`);
    for (const p of problems.slice(0, 15)) say(`  ${p}`);
    expect(problems, problems.slice(0, 20).join("\n")).toEqual([]);
  }, 1_800_000);

  it("explain_cost_change: usage, price and mix effects add up exactly to the oracle's change", async () => {
    // Project A's two latest months with priced turns.
    const priced = attributed.filter((a) => projectIdOf(a) === PROJECT_A && a.month !== null && figuresOf(a.turn, book).priced.known);
    const months = [...new Set(priced.map((a) => a.month!))].sort();
    expect(months.length, "project A has priced turns in fewer than two months").toBeGreaterThanOrEqual(2);
    const [periodA, periodB] = months.slice(-2) as [string, string];
    const args = { groupBy: "project", id: PROJECT_A, periodA, periodB, limit: LIMIT };
    const fromMcp = costVarianceSchema.parse(await callTool("explain_cost_change", args));
    const fromApi = costVarianceSchema.parse(await api.getCostVariance({ ...args, limit: String(LIMIT) }));
    expect({ ...fromMcp, generatedAt: "" }, "MCP and the Dashboard differ").toEqual({ ...fromApi, generatedAt: "" });
    const problems: string[] = [];
    for (const period of [periodA, periodB]) {
      const inPeriod = attributed.filter((a) => projectIdOf(a) === PROJECT_A && a.month === period);
      const known = inPeriod.filter((a) => figuresOf(a.turn, book).priced.known);
      const side = period === periodA ? "A" : "B";
      const notExplained = fromApi.notExplained[period === periodA ? "periodA" : "periodB"].turns;
      if (notExplained !== inPeriod.length - known.length) problems.push(`period ${side}: not explained ${notExplained} vs oracle ${inPeriod.length - known.length}`);
      for (const currency of CURRENCIES) {
        const expected = known.reduce((s, a) => {
          const f = figuresOf(a.turn, book).priced;
          return f.known && f.currency === currency ? s + f.amount : s;
        }, 0);
        const turns = known.filter((a) => {
          const f = figuresOf(a.turn, book).priced;
          return f.known && f.currency === currency;
        }).length;
        const row = fromApi.currencies.find((c) => c.currency === currency);
        const actual = row ? (side === "A" ? row.costA : row.costB) : 0;
        const actualTurns = row ? (side === "A" ? row.turnsA : row.turnsB) : 0;
        if (!near(actual, expected)) problems.push(`period ${side} ${currency}: cost ${actual} vs oracle ${expected}`);
        if (actualTurns !== turns) problems.push(`period ${side} ${currency}: turns ${actualTurns} vs oracle ${turns}`);
      }
    }
    for (const row of fromApi.currencies) {
      const sum = row.usage + row.price + row.mix;
      const scale = Math.max(1, row.costA, row.costB);
      if (Math.abs(sum - row.change) > TOLERANCE * scale) problems.push(`${row.currency}: usage + price + mix ${sum} vs change ${row.change}`);
      if (Math.abs(row.costB - row.costA - row.change) > TOLERANCE * scale) problems.push(`${row.currency}: change ${row.change} vs B - A ${row.costB - row.costA}`);
      say(`explain_cost_change ${PROJECT_A} ${periodA} -> ${periodB} (${row.currency}): ${round(row.costA)} -> ${round(row.costB)}, change ${round(row.change)} = usage ${round(row.usage)} + price ${round(row.price)} + mix ${round(row.mix)} (|sum - change| ${Math.abs(sum - row.change).toExponential(1)}); turns ${row.turnsA} -> ${row.turnsB}; ${row.models.length} models`);
    }
    say(`  not explained: ${fromApi.notExplained.periodA.turns} / ${fromApi.notExplained.periodB.turns} turns; ${fromApi.priceChanges.length} documented price changes between`);
    for (const p of problems) say(`  ${p}`);
    expect(problems, problems.join("\n")).toEqual([]);
  }, 1_800_000);

  it("get_price_changes lists every documented change in the window, as the price book has it", async () => {
    const list = priceChangeListSchema.parse(await callTool("get_price_changes", { kind: "documented", since: SINCE, until: UNTIL }));
    const fromApi = priceChangeListSchema.parse(await api.getPriceChanges({ kind: "documented", since: SINCE, until: UNTIL }));
    expect({ ...list, generatedAt: "" }).toEqual({ ...fromApi, generatedAt: "" });
    // A documented change: a list or promo version that follows another of the same model and channel.
    const expected = book
      .filter((v) => v.kind !== "contract" && v.effectiveFrom >= SINCE && v.effectiveFrom <= UNTIL)
      .filter((v) => book.some((w) => w !== v && w.kind !== "contract" && w.channel === v.channel && w.modelId === v.modelId && w.effectiveFrom < v.effectiveFrom));
    say(`get_price_changes: ${list.changes.length} documented changes in the window; the price book has ${expected.length} versions following an earlier one`);
    expect(list.changes.length).toBe(expected.length);
  }, 600_000);

  it("a statement keeps its figures after a price-book change, and lists the diff apart", async () => {
    const now = new Date().toISOString().slice(0, 7);
    const months = [...new Set(attributed.filter((a) => projectIdOf(a) === PROJECT_A && a.month !== null && a.month < now).map((a) => a.month!))].sort();
    expect(months.length, "project A has no turn in an ended month").toBeGreaterThan(0);
    const period = months.at(-1)!;
    const inPeriod = attributed.filter((a) => projectIdOf(a) === PROJECT_A && a.month === period);
    const issued = statementAnswerSchema.parse(await api.issueStatement(PROJECT_A, period));
    const statement = issued.statement;
    const problems: string[] = [];
    const known = inPeriod.filter((a) => figuresOf(a.turn, book).preferred.known);
    if (statement.coverage.turns !== inPeriod.length) problems.push(`coverage: ${statement.coverage.turns} turns vs oracle ${inPeriod.length}`);
    if (statement.coverage.knownTurns !== known.length) problems.push(`coverage: ${statement.coverage.knownTurns} known vs oracle ${known.length}`);
    for (const currency of CURRENCIES) {
      const expected = known.reduce((s, a) => {
        const f = figuresOf(a.turn, book).preferred;
        return f.known && f.currency === currency ? s + f.amount : s;
      }, 0);
      const actual = statement.totals.find((t) => t.currency === currency)?.lines ?? 0;
      if (!nearStatement(actual, expected)) problems.push(`${currency}: statement lines ${actual} vs oracle ${expected}`);
    }

    // The price-book change: a contract price, scoped to project A, at twice
    // the list price of the model it spent most on as priced.
    const pricedTurns = inPeriod.filter((a) => {
      const f = figuresOf(a.turn, book);
      return !f.billed.known && !f.reported.known && f.priced.known;
    });
    const byModel = new Map<string, { version: BookVersion; amount: number }>();
    for (const a of pricedTurns) {
      for (const part of a.turn.parts) {
        const priced = pricePart(a.turn, part, book);
        if (!priced) continue;
        const entry = byModel.get(priced.version.id) ?? { version: priced.version, amount: 0 };
        entry.amount += priced.amount;
        byModel.set(priced.version.id, entry);
      }
    }
    const target = [...byModel.values()].sort((a, b) => b.amount - a.amount)[0];
    let diffLine = "no priced turn in the period: the price-book step changes nothing";
    if (target) {
      const doubled = target.version.tiers.map((tier) =>
        Object.fromEntries(Object.entries(tier).map(([k, v]) => [k, k === "maxInputTokens" || v === null ? v : (v as number) * 2])),
      );
      const contract = {
        id: "real-data-contract",
        channel: target.version.channel,
        modelId: target.version.modelId,
        currency: "USD",
        effectiveFrom: SINCE,
        tiers: doubled,
        kind: "contract",
        scope: { projectId: PROJECT_A },
      };
      writeFileSync(path.join(settingsDir, "projects.json"), JSON.stringify(projectFileOf({ channels: { priceVersions: [contract] } }), null, 2));
      const after = statementAnswerSchema.parse(await api.getStatement({ projectId: PROJECT_A, period }));
      const fromMcp = statementAnswerSchema.parse(await callTool("get_statement", { projectId: PROJECT_A, period }));
      expect(after.statement, "the issued statement changed after the price-book update").toEqual(statement);
      expect(fromMcp.statement, "MCP shows another statement").toEqual(statement);
      expect(after.diff?.changed, "the re-run shows no diff").toBe(true);
      expect(after.diff?.inputs.priceBookChanged || after.diff?.inputs.projectsFileChanged).toBe(true);
      const currency: Currency = target.version.channel === "github-copilot" ? "AI_CREDITS" : "USD";
      const difference = after.diff?.totals.find((t) => t.currency === currency)?.difference ?? 0;
      if (!nearStatement(difference, target.amount)) problems.push(`diff ${currency}: ${difference} vs oracle ${target.amount}`);
      diffLine = `contract at twice the list price of the top priced model (${target.version.modelId}): issued figures unchanged, re-run diff ${round(difference)} ${currency} (oracle ${round(target.amount)}), ${after.diff?.lines.length} lines changed`;
      writeFileSync(path.join(settingsDir, "projects.json"), JSON.stringify(projectFileOf(), null, 2));
    }
    say(`statement ${PROJECT_A} ${period} (UTC): ${statement.lines.length} lines, totals ${statement.totals.map((t) => `${round(t.total)} ${t.currency}`).join(" + ") || "none"}, coverage ${statement.coverage.knownTurns}/${statement.coverage.turns} (oracle ${known.length}/${inPeriod.length}), ${statement.unknown.reduce((n, u) => n + u.turns, 0)} turns listed as unknown`);
    say(`  ${diffLine}`);
    for (const p of problems) say(`  ${p}`);
    expect(problems, problems.join("\n")).toEqual([]);
  }, 1_800_000);

  it("no unknown cost is shown or summed as zero, and knownTurns never exceeds turns", () => {
    const problems: string[] = [];
    let totals = 0;
    for (const { where, value } of [...productAnswers, ...mcpAnswers.map((a) => ({ where: a.tool, value: a.value }))]) totals += checkTotals(where, value, problems);
    say(`unknown never 0: ${totals} totals in ${productAnswers.length + mcpAnswers.length} answers checked; ${problems.length} problems`);
    for (const p of problems.slice(0, 10)) say(`  ${p}`);
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it("no tool answer holds prompt text or the home folder's path", () => {
    const WINDOW = 32;
    const prefixes = new Set(prompts.map((p) => p.trim()).filter((p) => p.length >= WINDOW).map((p) => p.slice(0, WINDOW)));
    const holdsPrompt = (s: string) => {
      for (let i = 0; i + WINDOW <= s.length; i++) if (prefixes.has(s.slice(i, i + WINDOW))) return true;
      return false;
    };
    const leaks: string[] = [];
    const hostIds = new Set(agentHostRaw.sessions.flatMap((read) => read.turns.map((t) => t.session)));
    const titled = new Map<string, Set<string>>(); // source -> session ids whose title holds a prompt's opening
    const searched = new Set<string>();
    for (const answer of mcpAnswers) {
      if (answer.text.includes(HOME)) leaks.push(`${answer.tool}: the home folder's path`);
      for (const { at, text } of stringsOf(answer.value)) {
        if (SESSION_TITLE_AT.test(at)) {
          const session = at.split(".").slice(1, -1).reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], answer.value) as { providerId: string; sessionId: string };
          searched.add(`${session.providerId}/${session.sessionId}`);
          const source = hostIds.has(session.sessionId) ? "Agent Host" : session.providerId;
          if (holdsPrompt(text)) titled.set(source, (titled.get(source) ?? new Set()).add(session.sessionId));
        } else if (holdsPrompt(text)) leaks.push(`${answer.tool}: a prompt's text at ${at.replace(/\.\d+/g, "[]")}`);
      }
    }
    say(`privacy: ${mcpAnswers.length} MCP answers searched for the home path and ${prefixes.size} prompt openings; ${leaks.length} found outside session titles`);
    say(`  statement session titles: ${searched.size} sessions searched; titles holding a prompt's opening (the source's own title, for the owner): ${[...titled].map(([provider, ids]) => `${provider} ${ids.size}`).join(", ") || "none"}`);
    expect([...new Set(leaks)]).toEqual([]);
  });

  it("changed no file on the machine", () => {
    const after = fingerprint(contentFiles, [ownerSettingsDir], stableFiles);
    const changed = before.split("\n").filter((line, i) => line !== after.split("\n")[i]);
    say(`read-only: ${before.split("\n").length} fingerprints (the app's own settings folder by content, ${stableFiles.length} session logs by size and mtime) identical before and after; the projects file and the statement lived in a temporary folder`);
    expect(after === before, `files changed: ${changed.length}`).toBe(true);
  });
});
