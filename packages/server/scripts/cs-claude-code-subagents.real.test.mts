// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// CS16 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/claude-code-subagents.md §10; 1.0 criterion C15): the
// automated check of Claude Code subagent usage over this machine's own logs.
// Opt-in and local only:
//
//   npm run test:real-data:claude-code-subagents
//   REAL_DATA_VIEW_PARENT=<dir> ...        (default ~/.cache: where the snapshot copy of the logs is made, about 4 GB; not tmpdir, which may be RAM)
//   REAL_DATA_CS16_TURNS_PER_SESSION=<n>   (get_turn checks per session, default 2)
//   REAL_DATA_CS16_REPLAY_SAMPLE=<n>       (sessions replayed, default 15)
//
// The oracle (claude-code-subagent-spend-lib.mts, folder scan in
// claude-code-subagent-spend-scan.mts) reads the raw transcripts and metas and
// the bundled price book, read-only, and shares no code with the product's
// readers, attribution, merge or pricer. The oracle and the products read one
// snapshot copy of the stable sessions (claude-code-view.mts; a live session,
// written in the last 15 minutes, never enters it), so every figure is over the
// same bytes even while a session grows: the standalone app over
// real HTTP, and its MCP server over an in-memory client, each composed as
// `mcp/stdio.ts` and `app.ts` compose them, over a temporary settings folder.
//
// Checked per session with a subagents folder: list = detail = oracle; each
// turn's own usage, runs and total; the session's totals and per-model tokens;
// the priced cost; replay coverage; the tool-call audit by origin. Aggregates:
// Σ runs, the cost rollup and each repository's cost. Privacy and read-only.
//
// Output carries counts, short hashes of session ids and sums: never a prompt,
// response, title, file content, path or money figure from the logs beyond the
// tolerances.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  costRollupSchema,
  costSeriesSchema,
  repositoryListSchema,
  sessionAuditSchema,
  sessionCostSchema,
  sessionReplaySchema,
  sessionSchema,
  turnViewSchema,
  type Session,
  type TokenCount,
  type TurnUsage,
} from "@agent-cost-analyzer/domain";
import { createApp } from "../src/app.js";
import { composeLogProviders } from "../src/composition/compose-log-providers.js";
import { createStandalonePriceBook } from "../src/composition/create-price-book.js";
import { createStandaloneAttribution } from "../src/composition/create-standalone-attribution.js";
import { createTurnPricer } from "../src/composition/create-turn-pricer.js";
import { createMcpServices } from "../src/composition/mcp-services.js";
import { loadVendorProfiles } from "../src/data-sources/vendor-profiles/loader.js";
import { createMcpServer } from "../src/mcp/mcp-server.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../src/test-support/vendor-profiles-dir.js";
import {
  oracleSession,
  pricedLines,
  pricedTurns,
  toolCallCounts,
  type OracleSession,
  type OracleSessionInput,
  type OracleTurn,
  type RawLine,
} from "./claude-code-subagent-spend-lib.mjs";
import { LIVE_MS, listClaudeSessions, readOracleInput, type ClaudeSessionFiles } from "./claude-code-subagent-spend-scan.mjs";
import { buildClaudeCodeView, createViewDir } from "./claude-code-view.mjs";
import { compareLogs, statLogs, type LogStat } from "./log-write-check.mjs";
import { leaksIn } from "./replay-oracle.mjs";
import { loadBundledTables } from "./savings-oracle.mjs";

const REAL_DATA = process.env.REAL_DATA === "1";
const HOME = homedir();
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");
const TURNS_PER_SESSION = Math.max(1, Number(process.env.REAL_DATA_CS16_TURNS_PER_SESSION ?? 2));
const REPLAY_SAMPLE = Math.max(1, Number(process.env.REAL_DATA_CS16_REPLAY_SAMPLE ?? 15));
// Both sides add the same prices to the same tokens; only summation order differs.
const USD_TOLERANCE = 0.01;
const APP_VERSION = "0.0.0-real-data";
const LEARN_SCRIPTS_DIR = path.join(FIXTURE_VENDOR_PROFILES_DIR, "..", "learn-scripts");
const REPLAY_MODEL = "claude-haiku-5.5";
const FIELDS = ["uncachedInput", "cacheWrite", "cacheRead", "output"] as const;

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const skipReason = !REAL_DATA ? "set REAL_DATA=1 to run" : !isDir(CLAUDE_PROJECTS) ? "no Claude Code logs (~/.claude/projects)" : null;

const tag = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 8);
const n = (count: TokenCount | undefined): number | null => (count?.known ? count.value : null);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const summary: string[] = [];
const say = (line: string) => {
  summary.push(line);
};

interface Row {
  files: ClaudeSessionFiles;
  id: string;
  oracle: OracleSession;
  // The subagents' prompts and the Agent calls' arguments, for the privacy check only: never printed.
  prompts: string[];
  // The folder holds a run, or the oracle counted one: the session is in the per-session checks.
  focus: boolean;
  runCount: number;
}

interface Answer {
  tool: string;
  text: string;
}

// Left out of the privacy check, which looks for what must not be there: the
// main agent's own text (the point of get_turn and the session titles) and the
// bounded, redacted arguments, working folders and error excerpts of ordinary
// tool calls, which the audit shows by design for the main agent and subagents
// alike (mcp/audit-call-output.ts). What a call of kind `subagent` holds, the
// subagent's prompt, is checked on its own: it keeps no argument summary.
const MAIN_AGENT_TEXT = new Set(["userMessage", "assistantResponse", "title", "argsSummary", "command", "cwd", "excerpt"]);
function withoutMainAgentText(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutMainAgentText);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !MAIN_AGENT_TEXT.has(key)).map(([key, v]) => [key, withoutMainAgentText(v)]));
}

let answersSeen = 0;

async function mcpCall(mcp: Client, name: string, args: Record<string, unknown>, raw: Answer[]): Promise<unknown> {
  const result = await mcp.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} answered with an error`);
  // The JSON text is the structured answer again; the sentences after it are the other text.
  const sentences = (result.content as { type: string; text?: string }[]).slice(1).map((item) => item.text ?? "");
  answersSeen += 1;
  // Every text value of the answer, filed under its tool and field name: a leak names where it was.
  const walk = (value: unknown, key: string) => {
    if (typeof value === "string") raw.push({ tool: `${name}.${key}`, text: value });
    else if (Array.isArray(value)) for (const item of value) walk(item, key);
    else if (typeof value === "object" && value !== null) for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(withoutMainAgentText(result.structuredContent ?? null), "");
  for (const text of sentences) raw.push({ tool: `${name}.sentence`, text });
  return result.structuredContent;
}

// What a subagent was told: the first prompt of each run's transcript and the
// prompt and description of every Agent call, in the session and in the runs.
function promptsOf(input: OracleSessionInput): string[] {
  const out: string[] = [];
  const agentCalls = (lines: readonly RawLine[]) => {
    for (const line of lines) {
      const blocks = (line.message as { content?: unknown } | undefined)?.content;
      if (line.type !== "assistant" || !Array.isArray(blocks)) continue;
      for (const block of blocks as { type?: string; name?: string; input?: { prompt?: unknown; description?: unknown } }[]) {
        if (block?.type !== "tool_use" || (block.name !== "Agent" && block.name !== "Task")) continue;
        for (const v of [block.input?.prompt, block.input?.description]) if (typeof v === "string") out.push(v);
      }
    }
  };
  agentCalls(input.lines);
  for (const run of input.runs) {
    if (run.transcript.status !== "read") continue;
    agentCalls(run.transcript.lines);
    const first = run.transcript.lines.find((l) => l.type === "user");
    if (first) out.push(textOfUser(first));
  }
  return out;
}

// ---- comparing the product's turn with the oracle's -------------------------

function diffTurnUsage(label: string, usage: TurnUsage, turn: OracleTurn): string[] {
  const problems: string[] = [];
  for (const field of FIELDS) {
    if (n(usage[field]) !== turn.total[field]) problems.push(`${label} ${field}: product ${n(usage[field])}, oracle ${turn.total[field]}`);
  }
  if (turn.runs.length === 0) return problems;
  if (usage.ownUsage === undefined) return [...problems, `${label}: no ownUsage`];
  for (const field of FIELDS) {
    if (n(usage.ownUsage[field]) !== turn.own[field]) problems.push(`${label} own ${field}: product ${n(usage.ownUsage[field])}, oracle ${turn.own[field]}`);
  }
  const runs = new Map((usage.subagents ?? []).map((run) => [run.id, run]));
  const expected = new Map(turn.runs.map((run) => [run.agentId, run]));
  const same = [...runs.keys()].sort().join() === [...expected.keys()].sort().join();
  if (!same) return [...problems, `${label}: runs ${runs.size} vs oracle ${expected.size} (ids differ)`];
  for (const [id, run] of expected) {
    const got = runs.get(id)!;
    for (const field of FIELDS) {
      if (n(got[field]) !== run.tokens[field]) problems.push(`${label} run ${tag(id)} ${field}: product ${n(got[field])}, oracle ${run.tokens[field]}`);
    }
    if (run.known && got.model !== run.model) problems.push(`${label} run ${tag(id)} model differs`);
    if (got.parentRunId !== run.parentAgentId) problems.push(`${label} run ${tag(id)} parent differs`);
    if ((got.attribution === "timestamp") !== (run.link === "timestamp")) problems.push(`${label} run ${tag(id)} attribution differs`);
  }
  return problems;
}

// Σ over the turns' totals, as a measure total: the known turns' sum, and how many.
function measure(oracle: OracleSession, pick: (t: OracleTurn) => number | null) {
  const known = oracle.turns.map(pick).filter((v): v is number => v !== null);
  return { value: known.length === 0 ? null : sum(known), knownTurns: known.length, turns: oracle.turns.length };
}

const inputOf = (t: OracleTurn): number | null => (t.total.uncachedInput === null || t.total.cacheWrite === null || t.total.cacheRead === null ? null : t.total.uncachedInput + t.total.cacheWrite + t.total.cacheRead);

// A run's four sums over a session's runs; null when any run is unknown or the session is.
function runSums(oracle: OracleSession): Record<(typeof FIELDS)[number], number | null> {
  const unknown = oracle.unknownKinds.length > 0;
  return Object.fromEntries(FIELDS.map((f) => [f, unknown ? null : sum(oracle.runs.map((r) => r.tokens[f] ?? 0))])) as Record<(typeof FIELDS)[number], number | null>;
}

// Output and input tokens per model, over the turns' lines: the main agent's own on the turn's model, each run on its own.
function tokensByModel(oracle: OracleSession): Map<string, { input: number; output: number }> {
  const out = new Map<string, { input: number; output: number }>();
  const addLine = (model: string, t: { uncachedInput: number | null; cacheWrite: number | null; cacheRead: number | null; output: number | null }) => {
    const entry = out.get(model) ?? { input: 0, output: 0 };
    entry.input += (t.uncachedInput ?? 0) + (t.cacheWrite ?? 0) + (t.cacheRead ?? 0);
    entry.output += t.output ?? 0;
    out.set(model, entry);
  };
  for (const turn of oracle.turns) {
    addLine(turn.ownModel, turn.own);
    for (const run of turn.runs) addLine(run.model, run.tokens);
  }
  for (const [model, v] of out) if (v.input === 0 && v.output === 0) out.delete(model);
  return out;
}

const textOfUser = (line: RawLine): string => {
  const content = (line.message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((b) => (typeof (b as { text?: unknown })?.text === "string" ? (b as { text: string }).text : "")).join(" ") : "";
};

(skipReason === null ? describe : describe.skip)(`Claude Code subagent usage, real data (CS16, C15)${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  const startedAt = Date.now();
  let viewDir = "";
  let settingsDir = "";
  let server: Server | undefined;
  let baseUrl = "";
  let mcp: Client;
  let before = new Map<string, LogStat>();
  // The owner's own files behind the snapshot, for the read-only check.
  let originals: string[] = [];
  let viewSessions: ClaudeSessionFiles[] = [];
  let live = 0;
  let rows: Row[] = [];
  const raw: Answer[] = [];
  // Calls of kind subagent that kept an argument summary in an MCP answer (the audit check counts them).
  let keptArgumentSummaries = 0;
  const tables = loadBundledTables(path.join(FIXTURE_VENDOR_PROFILES_DIR, ".."));
  const focus = () => rows.filter((r) => r.focus);
  const get = async (route: string): Promise<unknown> => {
    const response = await fetch(`${baseUrl}${route}`);
    if (!response.ok) throw new Error(`GET ${route.replace(/[0-9a-f]{16}/g, "#")} answered ${response.status}`);
    return response.json();
  };
  const cost = async (row: Row) => sessionCostSchema.parse(await mcpCall(mcp, "get_session_cost", { sessionId: row.id, provider: "claude-code", topTurns: 1 }, raw));
  const detail = async (row: Row): Promise<Session> => sessionSchema.parse(await get(`/api/sessions/${row.id}`));

  beforeAll(async () => {
    // One snapshot copy (write times kept) that the oracle and the products both read.
    viewDir = createViewDir("cs16-claude-view-");
    settingsDir = mkdtempSync(path.join(tmpdir(), "cs16-settings-"));
    const view = buildClaudeCodeView(CLAUDE_PROJECTS, viewDir, startedAt, LIVE_MS);
    originals = view.targets;
    live = view.live;
    before = statLogs(originals);
    viewSessions = listClaudeSessions(viewDir, startedAt).stable;

    const allFiles = viewSessions.map((s) => s.file);
    rows = viewSessions.map((files) => {
      const input = readOracleInput(files.file, allFiles);
      const oracle = oracleSession(input);
      const id = createHash("sha256").update(`${files.file}:${statSync(files.file).mtimeMs}`).digest("hex").slice(0, 16);
      return { files, id, oracle, prompts: promptsOf(input), focus: input.runs.length > 0 || oracle.runs.length > 0 || oracle.unknownKinds.length > 0, runCount: oracle.runs.length };
    });

    const providerOptions = {
      sessionStoreDbPath: undefined,
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
      agentHostUserDataDir: null,
      copilotHome: null,
      appSettingsDir: settingsDir,
      vscodeSettingsPath: null,
      claudeCodeProjectsDirPath: viewDir,
      piAgentSessionsDirPath: null,
      mitmproxyCapturesDirPath: null,
    };
    const app = createApp({ ...providerOptions, vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR, appVersion: APP_VERSION, learnScriptsDir: LEARN_SCRIPTS_DIR });
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const active = await fetch(`${baseUrl}/api/log-providers/active`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "claude-code" }) });
    if (!active.ok) throw new Error("could not select the Claude Code provider");

    const { registry } = composeLogProviders(providerOptions);
    const profiles = loadVendorProfiles(FIXTURE_VENDOR_PROFILES_DIR);
    const attribution = createStandaloneAttribution(registry, settingsDir, profiles);
    const priceBook = createStandalonePriceBook(settingsDir, attribution.catalog);
    const mcpServer = createMcpServer({
      ...createMcpServices(registry, APP_VERSION, undefined, attribution, createTurnPricer(priceBook), priceBook, undefined, { profiles, priceBook }),
      priceBook,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    mcp = new Client({ name: "cs16-real-data", version: "1.0.0" });
    await Promise.all([mcpServer.connect(serverTransport), mcp.connect(clientTransport)]);
  }, 1_800_000);

  afterAll(async () => {
    await mcp?.close();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    // Only copies: removing them leaves every log as it was.
    if (viewDir) rmSync(viewDir, { recursive: true, force: true });
    if (settingsDir) rmSync(settingsDir, { recursive: true, force: true });
    console.log(["", "Claude Code subagent usage, real-data summary (CS16, automated)", ...summary].join("\n"));
  });

  it("reads the logs with the oracle: sessions, runs, links, off-branch runs and what is unknown", () => {
    const runs = rows.flatMap((r) => r.oracle.runs);
    const kinds = new Map<string, number>();
    for (const r of rows) for (const k of r.oracle.unknownKinds) kinds.set(k, (kinds.get(k) ?? 0) + 1);
    const priced = rows.map((r) => pricedLines(r.oracle, tables));
    say(`sessions: ${rows.length} stable (${live} live left out); ${focus().length} with a subagents folder or a counted run`);
    say(`oracle runs counted: ${runs.length} (${runs.filter((r) => r.depth > 1).length} nested, ${runs.filter((r) => r.link === "timestamp").length} matched by time, ${runs.filter((r) => !r.known).length} unknown); off-branch runs not counted: ${sum(rows.map((r) => r.oracle.offBranchRunIds.length))}; calls counted in another session: ${sum(rows.map((r) => r.oracle.countedElsewhere))}`);
    say(`sessions unknown by the oracle: ${rows.filter((r) => r.oracle.unknownKinds.length > 0).length} ${JSON.stringify([...kinds])}; sessions the oracle can't price: ${priced.filter((p) => !p.known).length}`);
    expect(runs.length, "no subagent run on this machine: nothing to check").toBeGreaterThan(0);
  });

  it("HTTP: the list and the detail of each session equal the oracle (runs, tokens, each turn's own usage, runs and total)", async () => {
    const list = (await get("/api/sessions")) as Session[];
    const listed = new Map(list.map((s) => [s.id, s]));
    const problems: string[] = [];
    let turns = 0;
    for (const row of focus()) {
      const summaryRow = listed.get(row.id);
      const session = await detail(row);
      const t = tag(row.id);
      const expectedSpend = row.runCount > 0 || row.oracle.unknownKinds.length > 0;
      for (const [where, s] of [["list", summaryRow], ["detail", session]] as const) {
        if (s === undefined) {
          problems.push(`${t}: not in the ${where}`);
          continue;
        }
        const spend = s.subagentSpend;
        if (!expectedSpend && spend !== undefined) problems.push(`${t} ${where}: unexpected subagentSpend`);
        if (expectedSpend) {
          if (spend === undefined) problems.push(`${t} ${where}: no subagentSpend`);
          else {
            if (spend.runs !== row.runCount) problems.push(`${t} ${where}: ${spend.runs} runs, oracle ${row.runCount}`);
            const want = runSums(row.oracle);
            for (const f of FIELDS) if (n(spend.tokens?.[f]) !== want[f]) problems.push(`${t} ${where} subagentSpend ${f}: ${n(spend.tokens?.[f])} vs oracle ${want[f]}`);
          }
        }
      }
      if (session.turns.length !== row.oracle.turns.length) {
        problems.push(`${t}: ${session.turns.length} turns, oracle ${row.oracle.turns.length}`);
        continue;
      }
      session.turns.forEach((turn, i) => {
        turns += 1;
        problems.push(...diffTurnUsage(`${t} turn ${i}`, turn.usage, row.oracle.turns[i]!));
      });
    }
    say(`HTTP list and detail: ${focus().length} sessions, ${turns} turns compared: ${problems.length === 0 ? "PASS" : "FAIL"}`);
    expect(problems).toEqual([]);
  }, 1_800_000);

  it("MCP get_session_cost: totals, runs, tokens, priced cost and tokens per model equal the oracle", async () => {
    const problems: string[] = [];
    let priced = 0;
    let unpriceable = 0;
    for (const row of focus()) {
      const c = await cost(row);
      const t = tag(row.id);
      const o = row.oracle;
      for (const f of FIELDS) {
        const want = measure(o, (turn) => turn.total[f]);
        const got = c.totals[f];
        if (got.value !== want.value || got.knownTurns !== want.knownTurns || got.turns !== want.turns) problems.push(`${t} totals.${f}: ${JSON.stringify([got.value, got.knownTurns, got.turns])} vs oracle ${JSON.stringify([want.value, want.knownTurns, want.turns])}`);
      }
      const input = measure(o, inputOf);
      if (c.totals.inputTokens.value !== input.value || c.totals.inputTokens.knownTurns !== input.knownTurns) problems.push(`${t} totals.inputTokens differs`);
      const expectedSpend = row.runCount > 0 || o.unknownKinds.length > 0;
      if (!expectedSpend) {
        if (c.subagents !== undefined) problems.push(`${t}: unexpected subagents`);
      } else if (c.subagents === undefined) problems.push(`${t}: no subagents`);
      else {
        if (c.subagents.runs !== row.runCount) problems.push(`${t} subagents.runs ${c.subagents.runs} vs oracle ${row.runCount}`);
        const want = runSums(o);
        for (const f of FIELDS) if (c.subagents.tokens?.[f] !== want[f]) problems.push(`${t} subagents.tokens.${f}: ${c.subagents.tokens?.[f]} vs oracle ${want[f]}`);
      }
      // Tokens per model: the main agent's own on the turn's model, each run on its own.
      if (o.unknownKinds.length === 0) {
        const want = tokensByModel(o);
        const got = new Map(c.byModel.map((m) => [m.model, { input: m.inputTokens ?? 0, output: m.output ?? 0 }]));
        for (const [model, v] of [...got]) if (v.input === 0 && v.output === 0) got.delete(model);
        if ([...want.keys()].sort().join() !== [...got.keys()].sort().join()) problems.push(`${t} byModel models differ: product ${got.size}, oracle ${want.size}`);
        for (const [model, v] of want) {
          const g = got.get(model);
          if (g && (g.input !== v.input || g.output !== v.output)) problems.push(`${t} byModel ${tag(model)}: product ${g.input}/${g.output}, oracle ${v.input}/${v.output}`);
        }
      }
      // The priced cost: the oracle's turns, where it can price every line.
      const turnsPriced = pricedTurns(o, tables);
      const known = turnsPriced.filter((p) => p.usd !== null);
      // The turns the oracle can price (no turn without a model, no several-request line on a tiered price) are the product's known turns.
      priced += known.length;
      unpriceable += turnsPriced.length - known.length;
      const usd = c.cost.priced.usd;
      const want = known.length === 0 ? null : sum(known.map((p) => p.usd!));
      if ((usd === null) !== (want === null) || (usd !== null && Math.abs(usd - want!) > USD_TOLERANCE)) problems.push(`${t} priced cost differs from the oracle by more than ${USD_TOLERANCE} USD (product ${usd}, oracle ${want})`);
      if (c.cost.priced.knownTurns !== known.length) problems.push(`${t} priced knownTurns ${c.cost.priced.knownTurns} vs ${known.length}`);
      // The runs' own priced figure is known only when every line of the session is.
      const spendCost = c.subagents?.cost?.priced;
      if (expectedSpend && o.unknownKinds.length === 0 && known.length === turnsPriced.length) {
        const wantRuns = sum(turnsPriced.map((p) => p.runUsd));
        if (!spendCost?.known || Math.abs(spendCost.amount - wantRuns) > USD_TOLERANCE) problems.push(`${t} subagents priced cost differs from the oracle's runs by more than ${USD_TOLERANCE} USD`);
      }
    }
    say(`MCP get_session_cost: ${focus().length} sessions; priced cost and its known turns compared on ${priced} turns the oracle prices (${unpriceable} turns neither side can price: no model, an unpriced model, or several requests on a tiered price): ${problems.length === 0 ? "PASS" : "FAIL"}`);
    expect(problems).toEqual([]);
  }, 1_800_000);

  it("MCP get_turn: usage, ownUsage and runs of the busiest turns equal the oracle", async () => {
    const problems: string[] = [];
    let checked = 0;
    for (const row of focus()) {
      const busiest = row.oracle.turns
        .map((turn, index) => ({ turn, index }))
        .filter(({ turn }) => turn.runs.length > 0)
        .sort((a, b) => b.turn.runs.length - a.turn.runs.length)
        .slice(0, TURNS_PER_SESSION);
      for (const { turn, index } of busiest) {
        const view = turnViewSchema.parse(await mcpCall(mcp, "get_turn", { sessionId: row.id, turnIndex: index, provider: "claude-code" }, raw));
        checked += 1;
        problems.push(...diffTurnUsage(`${tag(row.id)} turn ${index}`, view.usage, turn));
        const subagentCalls = view.toolCalls.filter((c) => c.origin?.kind === "subagent").length;
        const want = turn.runs.filter((r) => r.readable).length;
        if (want === 0 && subagentCalls > 0) problems.push(`${tag(row.id)} turn ${index}: subagent calls from no readable run`);
      }
    }
    say(`MCP get_turn: ${checked} turns with runs compared: ${problems.length === 0 ? "PASS" : "FAIL"}`);
    expect(problems).toEqual([]);
  }, 1_800_000);

  it("replay: coverage.subagentRuns lists the oracle's runs with their tokens and priced cost, over HTTP and MCP alike", async () => {
    const sample = focus()
      .filter((r) => r.runCount > 0)
      .sort((a, b) => (b.files.newestMtimeMs ?? 0) - (a.files.newestMtimeMs ?? 0))
      .slice(0, REPLAY_SAMPLE);
    const problems: string[] = [];
    for (const row of sample) {
      const t = tag(row.id);
      const http = sessionReplaySchema.parse(await get(`/api/sessions/${row.id}/replay?model=${REPLAY_MODEL}&provider=claude-code`));
      const viaMcp = sessionReplaySchema.parse(await mcpCall(mcp, "replay_session", { sessionId: row.id, model: REPLAY_MODEL, provider: "claude-code" }, raw));
      const runs = http.coverage.subagentRuns;
      if (JSON.stringify(runs) !== JSON.stringify(viaMcp.coverage.subagentRuns)) problems.push(`${t}: HTTP and MCP coverage.subagentRuns differ`);
      if (runs === undefined) {
        problems.push(`${t}: no coverage.subagentRuns`);
        continue;
      }
      if (runs.runs !== row.runCount) problems.push(`${t}: ${runs.runs} runs, oracle ${row.runCount}`);
      const want = runSums(row.oracle);
      for (const f of FIELDS) if (n(runs.tokens?.[f]) !== want[f]) problems.push(`${t} coverage ${f}: ${n(runs.tokens?.[f])} vs oracle ${want[f]}`);
      const turnsPriced = pricedTurns(row.oracle, tables);
      if (row.oracle.unknownKinds.length === 0 && !turnsPriced.some((p) => p.usd === null)) {
        const priced = runs.cost?.priced;
        if (!priced?.known || Math.abs(priced.amount - sum(turnsPriced.map((p) => p.runUsd))) > USD_TOLERANCE) problems.push(`${t} coverage priced cost differs from the oracle's runs`);
      }
    }
    say(`replay coverage.subagentRuns: ${sample.length} sessions (of ${focus().filter((r) => r.runCount > 0).length} with runs), HTTP = MCP = oracle: ${problems.length === 0 ? "PASS" : "FAIL"}`);
    expect(problems).toEqual([]);
  }, 1_800_000);

  it("tool-call audit: main + subagents = totals, equal to the oracle's calls, a call id once, runs listed with origin", async () => {
    const problems: string[] = [];
    let calls = 0;
    let subagentCalls = 0;
    let unread = 0;
    for (const row of focus()) {
      const t = tag(row.id);
      const want = toolCallCounts(row.oracle);
      const http = sessionAuditSchema.parse(await get(`/api/sessions/${row.id}/audit?provider=claude-code`));
      const viaMcp = sessionAuditSchema.parse(await mcpCall(mcp, "get_session_audit", { sessionId: row.id, provider: "claude-code", includeCalls: true }, raw));
      calls += http.totals.toolCalls;
      keptArgumentSummaries += viaMcp.calls.filter((c) => c.call.kind === "subagent" && c.call.argsSummary !== "").length;
      if (row.runCount === 0) {
        if (http.byOrigin !== undefined) problems.push(`${t}: byOrigin without a run`);
        if (http.totals.toolCalls !== want.main) problems.push(`${t}: ${http.totals.toolCalls} calls, oracle ${want.main}`);
        continue;
      }
      const origin = http.byOrigin;
      if (origin === undefined) {
        problems.push(`${t}: no byOrigin`);
        continue;
      }
      subagentCalls += origin.subagents.toolCalls;
      if (origin.main.toolCalls !== want.main) problems.push(`${t} main calls ${origin.main.toolCalls} vs oracle ${want.main}`);
      if (origin.subagents.toolCalls !== want.subagents) problems.push(`${t} subagent calls ${origin.subagents.toolCalls} vs oracle ${want.subagents}`);
      if (origin.main.toolCalls + origin.subagents.toolCalls !== http.totals.toolCalls) problems.push(`${t}: byOrigin does not add up to the totals`);
      if (origin.subagents.runs !== (http.subagentRuns?.length ?? 0)) problems.push(`${t}: subagents.runs ${origin.subagents.runs} vs listed ${http.subagentRuns?.length ?? 0}`);
      const runs = new Map((http.subagentRuns ?? []).map((r) => [r.runId, r]));
      for (const [id, count] of want.byRun) if (runs.get(id)?.totals?.toolCalls !== count) problems.push(`${t} run ${tag(id)} calls ${runs.get(id)?.totals?.toolCalls} vs oracle ${count}`);
      const unreadListed = [...runs.values()].filter((r) => r.totals === null).map((r) => r.runId).sort();
      unread += unreadListed.length;
      if (unreadListed.join() !== want.unreadRuns.join()) problems.push(`${t}: unread runs ${unreadListed.length} vs oracle ${want.unreadRuns.length}`);
      for (const r of runs.values()) if (r.totals === null && !r.unreadReason) problems.push(`${t} run ${tag(r.runId)} unread without a reason`);
      const ids = http.calls.map((c) => c.call.id).filter((id): id is string => id !== undefined);
      if (new Set(ids).size !== ids.length) problems.push(`${t}: a tool-call id is listed twice`);
      if (JSON.stringify(viaMcp.byOrigin) !== JSON.stringify(origin)) problems.push(`${t}: MCP and HTTP byOrigin differ`);
      const bySubagent = http.calls.filter((c) => c.call.origin?.kind === "subagent").length;
      if (bySubagent !== want.subagents) problems.push(`${t}: ${bySubagent} calls with a subagent origin, oracle ${want.subagents}`);
      const total = (await mcpCall(mcp, "list_tool_calls", { sessionId: row.id, provider: "claude-code", origin: ["subagent"], limit: 1 }, raw)) as { total: number };
      if (total.total !== want.subagents) problems.push(`${t}: list_tool_calls origin subagent total ${total.total} vs oracle ${want.subagents}`);
    }
    say(`tool-call audit: ${focus().length} sessions, ${calls} calls (${subagentCalls} by subagents), ${unread} unread runs listed with a reason: ${problems.length === 0 ? "PASS" : "FAIL"}`);
    expect(problems).toEqual([]);
  }, 1_800_000);

  it("aggregates: Σ runs = the oracle's, the cost rollup and each repository's cost equal the oracle's sums", async () => {
    const problems: string[] = [];
    let runs = 0;
    const tokens = { uncachedInput: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    for (const row of focus()) {
      const c = await cost(row);
      runs += c.subagents?.runs ?? 0;
      if (row.oracle.unknownKinds.length === 0) for (const f of FIELDS) tokens[f] += c.subagents?.tokens?.[f] ?? 0;
    }
    const oracleRuns = sum(rows.map((r) => r.runCount));
    const oracleTokens = Object.fromEntries(FIELDS.map((f) => [f, sum(rows.filter((r) => r.oracle.unknownKinds.length === 0).map((r) => runSums(r.oracle)[f] ?? 0))]));
    if (runs !== oracleRuns) problems.push(`Σ runs ${runs} vs oracle ${oracleRuns}`);
    for (const f of FIELDS) if (tokens[f] !== oracleTokens[f]) problems.push(`Σ runs ${f}: product ${tokens[f]}, oracle ${oracleTokens[f]}`);

    const inRollup = rows;
    const rollup = costRollupSchema.parse(await mcpCall(mcp, "get_cost_rollup", { provider: "claude-code", limit: rows.length, topSessions: 1 }, raw));
    if (rollup.sessionCount !== inRollup.length) problems.push(`rollup read ${rollup.sessionCount} sessions, oracle ${inRollup.length} (${rows.length - inRollup.length} without a turn)`);
    for (const f of FIELDS) {
      const want = sum(inRollup.flatMap((r) => r.oracle.turns.map((t) => t.total[f] ?? 0)));
      if (rollup.totals[f].value !== want) problems.push(`rollup ${f}: ${rollup.totals[f].value} vs oracle ${want}`);
    }
    const usdOf = (r: Row) => sum(pricedTurns(r.oracle, tables).flatMap((p) => (p.usd === null ? [] : [p.usd])));
    const wantUsd = sum(inRollup.map(usdOf));
    if (rollup.cost.priced.usd === null || Math.abs(rollup.cost.priced.usd - wantUsd) > USD_TOLERANCE * Math.max(1, rows.length)) problems.push("rollup priced cost differs from the oracle's");

    // Each repository: its cost series equals the rollup's group, and the groups
    // (with the unattributed ones) add up to the rollup's total. A turn belongs to
    // the repository of the folder it ran in, so a repository's series equals the
    // sum of its sessions only where none of them ran a turn in another folder;
    // those equal sums are counted, the rest are explained by their moved turns.
    const repositories = repositoryListSchema.parse(await mcpCall(mcp, "list_repositories", { provider: "claude-code" }, raw));
    const sessionRepo = new Map<string, string | null>();
    const listedSessions = (await mcpCall(mcp, "list_sessions", { provider: "claude-code", limit: 1000 }, raw)) as { sessions: { id: string; repositoryKey?: string | null }[] };
    for (const s of listedSessions.sessions) sessionRepo.set(s.id, s.repositoryKey ?? null);
    let repos = 0;
    let seriesSessions = 0;
    let listedMembers = 0;
    let sessionListsDiffer = 0;
    let equalToSessions = 0;
    let unexplained = 0;
    for (const repo of repositories.repositories) {
      const series = costSeriesSchema.parse(await mcpCall(mcp, "get_repository_cost", { repository: repo.key, provider: "claude-code", limit: rows.length }, raw));
      const members = rows.filter((r) => sessionRepo.get(r.id) === repo.key);
      const want = sum(members.map(usdOf));
      const group = rollup.byRepository.find((g) => g.key === repo.key);
      repos += 1;
      // One frozen input: the series' session count is the list's, per repository.
      seriesSessions += series.sessions;
      listedMembers += members.length;
      if (series.sessions !== members.length) {
        sessionListsDiffer += 1;
        problems.push(`repository ${tag(repo.key)}: the series counts ${series.sessions} sessions, the session list ${members.length}`);
      }
      const usd = series.totals.priced.usd ?? 0;
      if (group !== undefined && Math.abs((group.cost.priced.usd ?? 0) - usd) > USD_TOLERANCE) problems.push(`repository ${tag(repo.key)}: the rollup's group differs from its series`);
      if (Math.abs(usd - want) <= USD_TOLERANCE * Math.max(1, members.length)) equalToSessions += 1;
      else {
        let moved = 0;
        for (const member of members) {
          const session = await detail(member);
          moved += session.turns.filter((t) => t.workspace !== undefined && JSON.stringify(t.workspace) !== JSON.stringify(session.workspace)).length;
        }
        if (moved === 0) {
          unexplained += 1;
          problems.push(`repository ${tag(repo.key)}: cost series (${series.sessions} sessions, ${usd}) differs from the sum of its ${members.length} sessions (${want}) with no turn run in another folder`);
        }
      }
    }
    const groupsUsd = sum(rollup.byRepository.map((g) => g.cost.priced.usd ?? 0));
    if (Math.abs(groupsUsd - (rollup.cost.priced.usd ?? 0)) > USD_TOLERANCE * Math.max(1, rows.length)) problems.push("the repository groups don't add up to the rollup's priced cost");
    say(`session lists compared: ${repos} repositories, ${seriesSessions} sessions in the series, ${listedMembers} in the list, ${sessionListsDiffer} repositories that differ: ${sessionListsDiffer === 0 ? "PASS" : "FAIL"}`);
    say(`aggregates: Σ runs ${runs} (oracle ${oracleRuns}); rollup over ${rollup.sessionCount} sessions; ${repos} repositories (${equalToSessions} equal to the sum of their sessions, ${repos - equalToSessions - unexplained} differ only where a session ran turns in another folder, ${unexplained} unexplained), groups add up to the rollup: ${problems.length === 0 ? "PASS" : "FAIL"}`);
    expect(problems).toEqual([]);
  }, 1_800_000);

  it("privacy: no MCP answer carries a subagent's prompt or an Agent call's arguments, and no call of kind subagent keeps an argument summary", async () => {
    const prompts = [...new Set(focus().flatMap((r) => r.prompts))];
    // Per tool, so a failure names the answer that carried it (counts only).
    const tools = [...new Set(raw.map((a) => a.tool))].sort();
    const leaksByTool = tools.map((tool) => ({ tool, ...leaksIn(raw.filter((a) => a.tool === tool).map((a) => a.text).join("\n"), HOME, prompts) }));
    const leaked = Math.max(0, ...leaksByTool.map((l) => l.prompts));
    const homePath = leaksByTool.filter((l) => l.homePath).map((l) => l.tool);
    say(`privacy: ${answersSeen} MCP answers (main-agent text left out) checked against ${prompts.length} subagent prompts and Agent-call arguments: leaks by tool ${JSON.stringify(leaksByTool.filter((l) => l.prompts > 0).map((l) => [l.tool, l.prompts]))}, home path in ${JSON.stringify(homePath)}, ${keptArgumentSummaries} subagent-kind calls with an argument summary: ${leaked === 0 && homePath.length === 0 && keptArgumentSummaries === 0 ? "PASS" : "FAIL"}`);
    expect(leaksByTool.filter((l) => l.prompts > 0).map((l) => l.tool)).toEqual([]);
    expect(homePath).toEqual([]);
    expect(keptArgumentSummaries).toBe(0);
  }, 1_800_000);

  it("left every log untouched (read-only; live sessions left out)", () => {
    // This check runs for many minutes beside Claude Code sessions that may be
    // resumed (or a subagent's meta rewritten as it finishes): a file whose write
    // time falls after the run began was written by its own session (log-write-check.mts).
    // A file that vanished, or changed with an older write time, would be a write by this check.
    const report = compareLogs(before, statLogs(originals), startedAt, tag);
    say(`read-only: ${before.size} log files by size and mtime: ${report.unchanged} unchanged, ${report.writtenDuringRun} written by their own session during the run (write time after it began), ${report.violations.length} changed without such a write time: ${report.violations.length === 0 ? "PASS" : "FAIL"}`);
    expect(report.violations).toEqual([]);
  });
});
