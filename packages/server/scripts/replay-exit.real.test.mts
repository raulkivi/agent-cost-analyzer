// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Phase 14: the automated check of the session replay's exit criterion
// (docs/plans/analyze-session-replay.md §13; 1.0 criterion C3), over this
// machine's own logs. Opt-in and local only:
//
//   npm run test:real-data:replay
//   REAL_DATA_USER_DATA="<dir>,<dir>" ...   (default ~/.config/Code and "~/.config/Code - Insiders")
//   REAL_DATA_REPLAY_SAMPLE=<n> ...         (sessions per provider, default 10)
//
// The oracle (replay-oracle.mts) reads the raw logs of the three providers with
// a request trace (Claude Code, Copilot's local harness, Copilot's Agent Host)
// and the bundled price book, with no code from the trace builders, the replay
// service, the simulator or the pricer. Per sampled session it recomputes:
//   - the turns, the main agent's requests per turn and the turns left out, by
//     kind (no request, incomplete counts, helpers only), the subagent runs left
//     out, and Copilot local's helper agents' requests (debugName other than
//     panel/editAgent), which the replay leaves out and counts (owner decision
//     2026-11-14);
//   - each turn's logged cache read, the read the own-model replay must
//     reproduce (the session's first request left out, A3) and the recorded
//     D12 outcome (hit, partial, miss);
//   - each turn's measured cost: Claude Code priced from the bundled API price
//     book; Copilot's local harness billed AI Credits from main.jsonl.
// The actual figures are the products' answers: the standalone app's ApiService
// (GET /api/sessions/:id/replay and /replay/compare), the extension's for
// Copilot, and the standalone MCP server's replay_session and
// compare_models_for_session. Copilot's turns are matched by position (the Nth
// user message is turn N); a session whose log and store disagree on the turn
// count is reported and left out of the per-turn checks.
//
// REAL_DATA_VIEW_PARENT=<dir> (default ~/.cache): where the snapshot copy of Claude Code's
// logs is made (about 4 GB; not tmpdir, which may be RAM). Removed when the check ends.
//
// Claude Code's subagent runs (C15, plan claude-code-subagents.md) are asserted
// like Copilot local's: coverage.subagentRuns lists them, with the runs' tokens,
// as the oracle reads them from the subagents/ folder (the check's view holds a
// copy of it). Reported, not asserted: Agent Host's sub-agent calls (plan §12.1,
// 14.8 note).
//
// Output carries counts, short hashes of session ids, model ids, token and
// money figures and tolerances: never a prompt, response, title, file content
// or path. Read-only (fingerprints before and after, as savings-exit does).
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  REPLAY_READ_TOLERANCE_PERCENT,
  sessionReplayComparisonSchema,
  sessionReplaySchema,
  type SessionReplay,
  type SessionReplayComparison,
} from "@agent-cost-analyzer/domain";
import { composeLogProviders } from "../src/composition/compose-log-providers.js";
import { createExtensionApiService } from "../src/composition/create-extension-api-service.js";
import { createStandalonePriceBook } from "../src/composition/create-price-book.js";
import { createStandaloneApiService } from "../src/composition/create-standalone-api-service.js";
import { createStandaloneAttribution } from "../src/composition/create-standalone-attribution.js";
import { createTurnPricer } from "../src/composition/create-turn-pricer.js";
import { createMcpServices } from "../src/composition/mcp-services.js";
import { resolveCopilotHome } from "../src/data-sources/agent-host/copilot-cli-paths.js";
import { listWorkspaceDebugLogsDirPaths } from "../src/data-sources/jsonl/session-log-path.js";
import { copilotChatGlobalStoragePath } from "../src/data-sources/sqlite/copilot-chat-global-storage-path.js";
import { loadVendorProfiles } from "../src/data-sources/vendor-profiles/loader.js";
import { createMcpServer } from "../src/mcp/mcp-server.js";
import { resolveAppSettingsDir } from "../src/platform/app-settings-dir/resolve-app-settings-dir.js";
import type { ApiService } from "../src/services/api/api-service.js";
import { InMemoryAppSettingsStore } from "../src/test-support/in-memory-app-settings-store.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../src/test-support/vendor-profiles-dir.js";
import { buildClaudeCodeView, createViewDir } from "./claude-code-view.mjs";
import { compareLogs, statLogs, type LogStat } from "./log-write-check.mjs";
import { idsHeldByOtherSessions, readRunFolder } from "./claude-subagent-runs-oracle.mjs";
import {
  agentHostSessionOf,
  claudeCodeSessionOf,
  leaksIn,
  priceClaudeCodeTurn,
  rankedModels,
  turnExpectations,
  vscodeLocalSessionOf,
  withinTolerance,
  type OracleSession,
} from "./replay-oracle.mjs";
import { loadBundledTables, parseJsonl, type RawLine } from "./savings-oracle.mjs";
import { agentHostCatalogSessions } from "./cost-by-project-oracle.mjs";

const REAL_DATA = process.env.REAL_DATA === "1";
const HOME = homedir();
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");
const defaultDirs = [path.join(HOME, ".config", "Code"), path.join(HOME, ".config", "Code - Insiders")];
const userDataDirs = (process.env.REAL_DATA_USER_DATA?.split(",").map((d) => d.trim()).filter(Boolean) ?? defaultDirs).filter(
  (d) => isDir(path.join(d, "User")),
);
const SAMPLE = Math.max(1, Number(process.env.REAL_DATA_REPLAY_SAMPLE ?? 10));
// Candidates tried per provider before giving up on filling the sample.
const MAX_TRIES = 60;
// The two other models each session is replayed on (the first two that aren't its own).
const OTHER_MODELS = ["claude-haiku-5.5", "gpt-6.1-sol", "gemini-4-argon"];
// A file written this recently belongs to a live session: left out (and counted).
const LIVE_MS = 15 * 60_000;
// Both sides are arithmetic over the same tokens and prices: only summation order differs.
const MONEY_TOLERANCE = 1e-9;
const APP_VERSION = "0.0.0-real-data";
const LEARN_SCRIPTS_DIR = path.join(FIXTURE_VENDOR_PROFILES_DIR, "..", "learn-scripts");

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const skipReason = !REAL_DATA ? "set REAL_DATA=1 to run" : !isDir(CLAUDE_PROJECTS) && userDataDirs.length === 0 ? "no Claude Code or VS Code logs" : null;

const near = (actual: number, expected: number) => Math.abs(actual - expected) <= MONEY_TOLERANCE * Math.max(1, Math.abs(expected));
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const tag = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 8);
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

// ---- read-only fingerprints, as savings-exit -----------------------------------

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

function fingerprint(settingsFiles: string[], configDirs: string[]): string {
  const lines: string[] = [];
  for (const file of settingsFiles) lines.push(`${file}|${existsSync(file) ? sha256(file) : "absent"}`);
  for (const dir of configDirs) {
    lines.push(`${dir}|${isDir(dir) ? "present" : "absent"}`);
    for (const file of listFiles(dir)) lines.push(`${file}|${sha256(file)}`);
  }
  return lines.join("\n");
}

// ---- the candidates, read by the oracle ------------------------------------------

type Kind = "Claude Code" | "VS Code local" | "Agent Host";

interface Candidate {
  kind: Kind;
  provider: "claude-code" | "vscode";
  id: string;
  // The raw log files the oracle reads (fingerprinted: they must not change).
  files: string[];
  mtimeMs: number;
  read: () => OracleSession;
}

const readLines = (file: string): RawLine[] => parseJsonl(readFileSync(file, "utf-8"));
// main.jsonl spans carry `type` too, so the same tolerant reader serves.
const stableSince = (now: number, files: string[]) => files.every((f) => now - statSync(f).mtimeMs >= LIVE_MS);

interface ClaudeView {
  dir: string;
  candidates: Candidate[];
  live: number;
}

// The view the products read (claude-code-view.mts: a snapshot copy of each stable
// session file and of its subagents/ folder), so the oracle and the products read
// the same bytes. The products name a session by sha256("<file path>:<mtimeMs>")[0..16]
// (the log's identity, not a figure).
function buildClaudeView(now: number): ClaudeView {
  const dir = createViewDir("replay-exit-claude-");
  const view = buildClaudeCodeView(CLAUDE_PROJECTS, dir, now, LIVE_MS);
  const candidates: Candidate[] = view.sessions.map(({ link, source: target, runSources }) => {
    const mtimeMs = statSync(link).mtimeMs; // the copy's: the product hashes what it stats
    return {
      kind: "Claude Code",
      provider: "claude-code",
      id: createHash("sha256").update(`${link}:${mtimeMs}`).digest("hex").slice(0, 16),
      files: [target, ...runSources],
      mtimeMs,
      read: () => claudeCodeSessionOf(readLines(link), { runs: readRunFolder(link), heldElsewhere: idsHeldByOtherSessions(link) }),
    };
  });
  return { dir, candidates, live: view.live };
}

// Copilot's local harness: one debug-log folder per session, named by its id.
function localCandidates(userData: string, now: number): { candidates: Candidate[]; live: number } {
  const candidates: Candidate[] = [];
  let live = 0;
  for (const root of listWorkspaceDebugLogsDirPaths({ userDataDir: userData })) {
    let ids: string[];
    try {
      ids = readdirSync(root);
    } catch {
      continue;
    }
    for (const id of ids) {
      const main = path.join(root, id, "main.jsonl");
      if (!existsSync(main)) continue;
      const files = listFiles(path.join(root, id));
      if (!stableSince(now, files)) {
        live += 1;
        continue;
      }
      candidates.push({ kind: "VS Code local", provider: "vscode", id, files: [main], mtimeMs: statSync(main).mtimeMs, read: () => vscodeLocalSessionOf(readLines(main)) });
    }
  }
  return { candidates, live };
}

// Agent Host: the catalog (agent-host.db) names each session and, through its
// chat row, the Copilot CLI session whose events.jsonl holds the calls.
function agentHostCandidates(userData: string, now: number): { candidates: Candidate[]; live: number } {
  const dbPath = path.join(userData, "User", "globalStorage", "agent-host.db");
  const copilotHome = resolveCopilotHome();
  const candidates: Candidate[] = [];
  let live = 0;
  if (!existsSync(dbPath) || copilotHome === null) return { candidates, live };
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT s.session_uri AS uri, c.provider_data AS data FROM sessions_v2 s JOIN chats_v2 c ON c.owner_session_uri = s.session_uri WHERE s.provider = 'copilotcli'").all() as { uri: string; data: unknown }[];
    // One session per id under either URI scheme (the V4 oracle's rule); as
    // before, tombstones aren't consulted: the products skip what they can't read.
    const cataloged = agentHostCatalogSessions([...new Set(rows.map((r) => r.uri))].map((uri) => ({ session_uri: uri })), new Set());
    const idOf = new Map(cataloged.map((s) => [s.row.session_uri, s.id]));
    const seen = new Set<string>();
    for (const { uri, data } of rows) {
      const id = idOf.get(uri);
      if (id === undefined || seen.has(id)) continue;
      let sdk: unknown;
      try {
        sdk = typeof data === "string" ? (JSON.parse(data) as Record<string, unknown>).sdkSessionId : undefined;
      } catch {
        continue;
      }
      if (typeof sdk !== "string" || !/^[0-9A-Za-z][0-9A-Za-z-]*$/.test(sdk)) continue;
      const events = path.join(copilotHome, "session-state", sdk, "events.jsonl");
      if (!existsSync(events)) continue;
      seen.add(id);
      if (!stableSince(now, [events])) {
        live += 1;
        continue;
      }
      candidates.push({
        kind: "Agent Host",
        provider: "vscode",
        id,
        files: [events],
        mtimeMs: statSync(events).mtimeMs,
        read: () => agentHostSessionOf(readLines(events)),
      });
    }
  } finally {
    db.close();
  }
  return { candidates, live };
}

// ---- the products ------------------------------------------------------------------

interface Products {
  api: ApiService;
  // The extension's ApiService, for Copilot sessions (absent for Claude Code).
  extension?: ApiService;
  mcp: Client;
}

function copilotPaths(userData: string | undefined) {
  return {
    sessionStoreDbPath: userData ? copilotChatGlobalStoragePath(userData, "session-store.db") : null,
    debugLogsDirPaths: userData ? listWorkspaceDebugLogsDirPaths({ userDataDir: userData }) : [],
    agentTracesDbPath: userData ? copilotChatGlobalStoragePath(userData, "agent-traces.db") : null,
    agentHostUserDataDir: userData ?? null,
    copilotHome: resolveCopilotHome(),
  };
}

// The standalone app (API and MCP server, as stdio.ts composes it) over the
// Claude Code view and one VS Code edition, every other provider off.
async function composeProducts(claudeDir: string, userData: string | undefined, appSettingsDir: string): Promise<Products> {
  const paths = copilotPaths(userData);
  const providerOptions = {
    ...paths,
    sessionStoreDbPath: paths.sessionStoreDbPath ?? undefined,
    appSettingsDir,
    vscodeSettingsPath: null,
    claudeCodeProjectsDirPath: claudeDir,
    piAgentSessionsDirPath: null,
    mitmproxyCapturesDirPath: null,
  };
  const api = createStandaloneApiService({ ...providerOptions, vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR, appVersion: APP_VERSION, learnScriptsDir: LEARN_SCRIPTS_DIR });
  const { registry } = composeLogProviders(providerOptions);
  const profiles = loadVendorProfiles(FIXTURE_VENDOR_PROFILES_DIR);
  const attribution = createStandaloneAttribution(registry, appSettingsDir, profiles);
  const priceBook = createStandalonePriceBook(appSettingsDir, attribution.catalog);
  const server = createMcpServer({
    ...createMcpServices(registry, APP_VERSION, undefined, attribution, createTurnPricer(priceBook), priceBook, undefined, { profiles, priceBook }),
    priceBook,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "replay-exit-real-data", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  const extension = userData
    ? createExtensionApiService({
        ...paths,
        vscodeSettingsPath: null,
        appSettings: new InMemoryAppSettingsStore(),
        learnScriptsDir: LEARN_SCRIPTS_DIR,
        vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR,
        appVersion: APP_VERSION,
      })
    : undefined;
  return { api, mcp, ...(extension ? { extension } : {}) };
}

// ---- one sampled session ----------------------------------------------------------

interface Answers {
  own: SessionReplay;
  others: SessionReplay[];
  compare: SessionReplayComparison;
}

interface Sampled {
  candidate: Candidate;
  oracle: OracleSession;
  // The models asked for: the session's first (log spelling), then the two others.
  models: string[];
  api: Answers;
  mcp: Answers;
  extension?: Answers;
  // Every answer's JSON, for the privacy check (never printed).
  raw: string[];
}

async function apiAnswers(api: ApiService, c: Candidate, own: string, raw: string[]): Promise<{ answers: Answers; models: string[] }> {
  const ownReplay = sessionReplaySchema.parse(await api.getSessionReplay(c.id, { model: own, provider: c.provider }));
  const others = OTHER_MODELS.filter((m) => m !== ownReplay.model).slice(0, 2);
  const otherReplays: SessionReplay[] = [];
  for (const model of others) otherReplays.push(sessionReplaySchema.parse(await api.getSessionReplay(c.id, { model, provider: c.provider })));
  const compare = sessionReplayComparisonSchema.parse(await api.compareSessionReplay(c.id, { models: others.join(","), provider: c.provider }));
  raw.push(JSON.stringify(ownReplay), ...otherReplays.map((r) => JSON.stringify(r)), JSON.stringify(compare));
  return { answers: { own: ownReplay, others: otherReplays, compare }, models: [own, ...others] };
}

async function mcpCall(mcp: Client, name: string, args: Record<string, unknown>, raw: string[]): Promise<unknown> {
  const result = await mcp.callTool({ name, arguments: args });
  raw.push(JSON.stringify(result.content), JSON.stringify(result.structuredContent ?? null));
  if (result.isError) throw new Error(`${name} answered with an error`);
  return result.structuredContent;
}

async function mcpAnswers(mcp: Client, c: Candidate, models: string[], raw: string[]): Promise<Answers> {
  const [own, ...others] = models;
  const replay = async (model: string) => sessionReplaySchema.parse(await mcpCall(mcp, "replay_session", { sessionId: c.id, model, provider: c.provider }, raw));
  return {
    own: await replay(own!),
    others: await Promise.all(others.map(replay)),
    compare: sessionReplayComparisonSchema.parse(await mcpCall(mcp, "compare_models_for_session", { sessionId: c.id, models: others, provider: c.provider }, raw)),
  };
}

// A per-turn comparison is possible when the replay's turns are the oracle's.
const comparable = (s: Sampled) => s.api.own.coverage.turns === s.oracle.turns;

const summary: string[] = [];
const say = (line: string) => {
  summary.push(line);
};

(skipReason === null ? describe : describe.skip)(`Session replay exit criterion, real data${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  const startedAt = Date.now();
  const appSettingsDir = resolveAppSettingsDir();
  const settingsFiles = [
    path.join(HOME, ".claude", "settings.json"),
    path.join(HOME, ".claude", "settings.local.json"),
    path.join(HOME, ".claude.json"),
    ...userDataDirs.map((d) => path.join(d, "User", "settings.json")),
  ];
  const configDirs = [appSettingsDir];
  const tables = loadBundledTables(path.join(FIXTURE_VENDOR_PROFILES_DIR, ".."));

  let view: ClaudeView;
  let before = "";
  let logsBefore = new Map<string, LogStat>();
  const logs: string[] = [];
  const sampled: Sampled[] = [];
  const skipped = new Map<string, number>();
  const live = new Map<Kind, number>();
  const offered = new Map<Kind, number>();
  const clients: Client[] = [];
  const of = (kind: Kind) => sampled.filter((s) => s.candidate.kind === kind);
  const KINDS: Kind[] = ["Claude Code", "VS Code local", "Agent Host"];

  async function sample(kind: Kind, candidates: Candidate[], products: Products) {
    offered.set(kind, (offered.get(kind) ?? 0) + candidates.length);
    let tries = 0;
    for (const candidate of [...candidates].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
      if (of(kind).length >= SAMPLE || tries >= MAX_TRIES) break;
      const oracle = candidate.read();
      // Something to compare: two requests at least (the first is never compared, A3).
      if (oracle.requests.length < 2) continue;
      tries += 1;
      const raw: string[] = [];
      let api: { answers: Answers; models: string[] };
      try {
        api = await apiAnswers(products.api, candidate, oracle.requests[0]!.model, raw);
      } catch (error) {
        const reason = `${kind}: ${error instanceof Error ? error.message.replace(/[0-9a-f]{8,}|\d[\d,]*/g, "#").slice(0, 90) : "error"}`;
        skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
        continue;
      }
      const mcp = await mcpAnswers(products.mcp, candidate, api.models, raw);
      let extension: Answers | undefined;
      if (products.extension && candidate.provider === "vscode") extension = (await apiAnswers(products.extension, candidate, oracle.requests[0]!.model, raw)).answers;
      logs.push(...candidate.files);
      sampled.push({ candidate, oracle, models: api.models, api: api.answers, mcp, ...(extension ? { extension } : {}), raw });
    }
  }

  beforeAll(async () => {
    view = buildClaudeView(startedAt);
    live.set("Claude Code", view.live);
    const editions = userDataDirs.map((userData) => ({ userData, local: localCandidates(userData, startedAt), host: agentHostCandidates(userData, startedAt) }));
    const allLogs = [...view.candidates, ...editions.flatMap((e) => [...e.local.candidates, ...e.host.candidates])].flatMap((c) => c.files);
    before = fingerprint(settingsFiles, configDirs);
    logsBefore = statLogs(allLogs);

    const claude = await composeProducts(view.dir, undefined, appSettingsDir);
    clients.push(claude.mcp);
    await sample("Claude Code", view.candidates, claude);
    for (const edition of editions) {
      const products = await composeProducts(view.dir, edition.userData, appSettingsDir);
      clients.push(products.mcp);
      live.set("VS Code local", (live.get("VS Code local") ?? 0) + edition.local.live);
      live.set("Agent Host", (live.get("Agent Host") ?? 0) + edition.host.live);
      await sample("VS Code local", edition.local.candidates, products);
      await sample("Agent Host", edition.host.candidates, products);
    }
    // Every log the oracle may have read, for the read-only check.
    logs.splice(0, logs.length, ...allLogs);
  }, 1_800_000);

  afterAll(async () => {
    for (const client of clients) await client.close();
    if (view?.dir) rmSync(view.dir, { recursive: true, force: true });
    console.log(["", "Session replay exit-criterion summary (§13, automated)", ...summary].join("\n"));
  });

  it("samples real sessions of each provider with a request trace", () => {
    say(`sample: up to ${SAMPLE} sessions per provider, newest first, ≥2 main-agent requests; other models tried: ${OTHER_MODELS.join(", ")}; D12 read tolerance ${REPLAY_READ_TOLERANCE_PERCENT}%, money tolerance ${MONEY_TOLERANCE} relative`);
    for (const kind of KINDS) {
      const rows = of(kind);
      const requests = rows.reduce((n, s) => n + s.oracle.requests.length, 0);
      const turns = rows.reduce((n, s) => n + s.oracle.turns, 0);
      say(`${kind}: ${offered.get(kind) ?? 0} stable sessions found (${live.get(kind) ?? 0} live left out); sampled ${rows.length}: ${turns} turns, ${requests} main-agent requests; models ${[...new Set(rows.map((s) => s.api.own.model))].join(", ") || "-"}`);
    }
    for (const [reason, n] of skipped) say(`  not replayable (skipped): ${n} × ${reason}`);
    expect(of("Claude Code").length, "no replayable Claude Code session").toBeGreaterThan(0);
    expect(of("VS Code local").length + of("Agent Host").length, "no replayable Copilot session").toBeGreaterThan(0);
  });

  it("coverage lists exactly the turns left out, with reasons, and the requests the oracle rebuilds", () => {
    const problems: string[] = [];
    let incomparable = 0;
    let leftOut = 0;
    for (const s of sampled) {
      const { coverage, turns } = s.api.own;
      const name = `${s.candidate.kind} ${tag(s.candidate.id)}`;
      // Claude Code's turns are the log's; a Copilot store may list turns its log lacks.
      if (!comparable(s)) {
        incomparable += 1;
        if (s.candidate.kind === "Claude Code") problems.push(`${name}: ${coverage.turns} turns, oracle ${s.oracle.turns}`);
        continue;
      }
      const notReplayed = turns.filter((t) => t.simulated === null);
      leftOut += notReplayed.length;
      if (coverage.requests !== s.oracle.requests.length) problems.push(`${name}: ${coverage.requests} requests, oracle ${s.oracle.requests.length}`);
      const expected = [...s.oracle.untraced.keys()].sort((a, b) => a - b);
      const actual = notReplayed.map((t) => t.turnIndex);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`${name}: turns not replayed ${JSON.stringify(actual)}, oracle ${JSON.stringify(expected)}`);
      if (notReplayed.some((t) => !t.notReplayedReason)) problems.push(`${name}: a turn not replayed has no reason`);
      if (coverage.notReplayed.reduce((n, r) => n + r.turns, 0) !== notReplayed.length) problems.push(`${name}: coverage reasons don't add up to the turns not replayed`);
      if (coverage.replayedTurns !== turns.length - notReplayed.length) problems.push(`${name}: replayedTurns`);
    }
    say("");
    say(`Coverage: ${sampled.length - incomparable} sessions compared turn by turn (${incomparable} Copilot sessions whose store and log disagree on turns left out); ${leftOut} turns not replayed, each with its reason; requests per session equal the oracle's: ${problems.length === 0 ? "PASS" : "FAIL"}`);
    expect(problems).toEqual([]);
  });

  it("coverage counts the subagent runs and helper-agent requests left out where the provider reads them (Copilot local); Claude Code lists them with their tokens; Agent Host reports them", () => {
    const problems: string[] = [];
    const helperProblems: string[] = [];
    for (const s of of("VS Code local").filter(comparable)) {
      const runs = s.api.own.coverage.subagentRuns?.runs ?? 0;
      if (runs !== s.oracle.subagentRuns) problems.push(`${tag(s.candidate.id)}: ${runs} runs, oracle ${s.oracle.subagentRuns}`);
      // The helper agents' requests: their count, and their AI Credits (unknown when one isn't recorded).
      const helpers = s.api.own.coverage.helperRequests;
      const expected = s.oracle.leftOut;
      if ((helpers?.requests ?? 0) !== expected.length) helperProblems.push(`${tag(s.candidate.id)}: ${helpers?.requests ?? 0} helper requests, oracle ${expected.length}`);
      if (helpers && expected.length > 0) {
        const allKnown = expected.every((r) => r.nanoAiu !== null);
        const credits = expected.reduce((n, r) => n + (r.nanoAiu ?? 0), 0) / 1_000_000_000;
        if (helpers.costAiCredits.known !== allKnown || (helpers.costAiCredits.known && !near(helpers.costAiCredits.value, credits))) helperProblems.push(`${tag(s.candidate.id)}: helper AI Credits differ from the oracle's`);
      }
      if (JSON.stringify(s.api.compare.helperRequests) !== JSON.stringify(helpers)) helperProblems.push(`${tag(s.candidate.id)}: the comparison's helper requests differ from the replay's`);
    }
    const local = of("VS Code local").filter(comparable);
    say(`Subagent runs, Copilot local: ${local.reduce((n, s) => n + s.oracle.subagentRuns, 0)} runs in ${local.filter((s) => s.oracle.subagentRuns > 0).length} sessions, coverage.subagentRuns equal per session: ${problems.length === 0 ? "PASS" : "FAIL"}`);
    const helperCredits = local.reduce((n, s) => n + s.oracle.leftOut.reduce((m, r) => m + (r.nanoAiu ?? 0), 0), 0) / 1_000_000_000;
    say(`Helper-agent requests, Copilot local: ${local.reduce((n, s) => n + s.oracle.leftOut.length, 0)} in ${local.filter((s) => s.oracle.leftOut.length > 0).length} sessions (${helperCredits.toFixed(4)} AI Credits), left out of the chain; coverage.helperRequests count and AI Credits equal per session: ${helperProblems.length === 0 ? "PASS" : "FAIL"}`);
    problems.push(...helperProblems);
    const claude = of("Claude Code");
    const host = of("Agent Host");
    const claudeProblems: string[] = [];
    for (const s of claude) {
      const listed = s.api.own.coverage.subagentRuns;
      const expected = s.oracle.subagentTokens;
      if ((listed?.runs ?? 0) !== s.oracle.subagentRuns) claudeProblems.push(`${tag(s.candidate.id)}: ${listed?.runs ?? 0} runs, oracle ${s.oracle.subagentRuns}`);
      if ((listed === undefined) !== (expected === undefined)) claudeProblems.push(`${tag(s.candidate.id)}: coverage.subagentRuns ${listed === undefined ? "absent" : "present"}, oracle ${expected === undefined ? "none" : "lists it"}`);
      if (listed?.tokens !== undefined && expected !== undefined) {
        const fields = { uncached: listed.tokens.uncachedInput, cacheWrite: listed.tokens.cacheWrite, cacheRead: listed.tokens.cacheRead, output: listed.tokens.output };
        for (const [name, count] of Object.entries(fields)) {
          if (count.known !== (expected !== null) || (count.known && expected !== null && count.value !== expected[name as keyof typeof expected])) claudeProblems.push(`${tag(s.candidate.id)}: run tokens (${name}) differ from the oracle's`);
        }
      }
    }
    const claudeRuns = claude.reduce((n, s) => n + s.oracle.subagentRuns, 0);
    const claudeUnknown = claude.filter((s) => s.oracle.subagentTokens === null).length;
    say(`Subagent runs, Claude Code: ${claudeRuns} runs in ${claude.filter((s) => s.oracle.subagentRuns > 0).length} sessions (${claudeUnknown} sessions with an unknown run figure), coverage.subagentRuns runs and run tokens equal per session: ${claudeProblems.length === 0 ? "PASS" : "FAIL"}`);
    problems.push(...claudeProblems);
    const hostRuns = host.reduce((n, s) => n + s.oracle.subagentRuns, 0);
    say(`  Agent Host: ${hostRuns} sub-agents' calls outside the main chain (D6); only a turn with nothing else is listed, as a turn not replayed`);
    for (const s of host) {
      if (s.api.own.coverage.subagentRuns !== undefined) problems.push(`${s.candidate.kind} ${tag(s.candidate.id)}: unexpected subagentRuns`);
    }
    for (const s of [...claude, ...host]) {
      if (s.api.own.coverage.helperRequests !== undefined) problems.push(`${s.candidate.kind} ${tag(s.candidate.id)}: unexpected helperRequests`);
    }
    expect(problems).toEqual([]);
  });

  it("each replayed turn's measured cache read is the log's", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const s of sampled.filter(comparable)) {
      const expected = turnExpectations(s.oracle);
      for (const turn of s.api.own.turns) {
        const e = expected.get(turn.turnIndex);
        if (!e || turn.simulated === null) continue;
        checked += 1;
        if (turn.measured.cacheRead !== e.loggedRead) problems.push(`${s.candidate.kind} ${tag(s.candidate.id)} turn ${turn.turnIndex}: ${turn.measured.cacheRead}, oracle ${e.loggedRead}`);
      }
    }
    say(`Measured cache reads: ${checked} replayed turns, equal to the oracle's sum of logged reads (exact): ${problems.length === 0 ? "PASS" : `FAIL (${problems.length})`}`);
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it("the self-check on the session's own model matches the log at D12's tolerance, and the oracle agrees turn by turn", () => {
    const problems: string[] = [];
    say("");
    say(`Self-check (own model, every request but the first: cache read within ${REPLAY_READ_TOLERANCE_PERCENT}% and the same hit/partial/miss):`);
    for (const kind of KINDS) {
      const rows = of(kind);
      if (rows.length === 0) continue;
      let requests = 0;
      let matching = 0;
      let passed = 0;
      let confirmed = 0;
      let agreeing = 0;
      let turnsChecked = 0;
      let nulls = 0;
      for (const s of rows) {
        const check = s.api.own.selfCheck;
        const name = `${kind} ${tag(s.candidate.id)}`;
        if (check === null) {
          nulls += 1;
          continue;
        }
        requests += check.requests;
        matching += check.matching;
        if (check.readTolerancePercent !== REPLAY_READ_TOLERANCE_PERCENT) problems.push(`${name}: tolerance ${check.readTolerancePercent}`);
        if (check.requests !== s.api.own.coverage.requests - 1) problems.push(`${name}: self-check compares ${check.requests} of ${s.api.own.coverage.requests} requests`);
        if (comparable(s) && check.requests !== s.oracle.requests.length - 1) problems.push(`${name}: self-check compares ${check.requests}, oracle ${s.oracle.requests.length - 1}`);
        if (check.passed) passed += 1;
        // The own-model replay's turn rows are the self-check's simulation when the
        // session used one model (a switch is replayed whole on the first model).
        if (!comparable(s) || s.api.own.measuredModels.length !== 1) continue;
        const expected = turnExpectations(s.oracle);
        let all = true;
        for (const turn of s.api.own.turns) {
          const e = expected.get(turn.turnIndex);
          if (!e || turn.simulated === null) continue;
          turnsChecked += 1;
          const readOk = withinTolerance(turn.simulated.cacheRead, e.comparedRead, REPLAY_READ_TOLERANCE_PERCENT);
          const outcomeOk = e.holdsFirstRequest || e.outcome === undefined || turn.simulated.outcome === e.outcome;
          if (readOk && outcomeOk) agreeing += 1;
          else all = false;
        }
        if (check.passed && !all) problems.push(`${name}: self-check passed but the oracle finds a turn outside D12's tolerance`);
        if (check.passed && all) confirmed += 1;
      }
      say(`  ${kind}: ${rows.length - nulls} self-checks (${nulls} null: own model without a profile or 3+ models), ${passed} passed; ${matching} of ${requests} requests match (${pct(matching, requests)}); oracle: ${agreeing} of ${turnsChecked} single-model turns within tolerance, ${confirmed} passing sessions confirmed turn by turn`);
    }
    // The chain is the main agent's alone (owner decision 2026-11-14): no helper's request is replayed.
    for (const s of of("VS Code local").filter(comparable)) {
      if (s.api.own.coverage.requests !== s.oracle.requests.length) problems.push(`VS Code local ${tag(s.candidate.id)}: ${s.api.own.coverage.requests} chain requests, oracle's main agent ${s.oracle.requests.length}`);
    }
    const passing = (kinds: Kind[]) => sampled.filter((s) => kinds.includes(s.candidate.kind) && s.api.own.selfCheck?.passed === true).length;
    say(`  §13: a Claude Code session passes: ${passing(["Claude Code"]) > 0 ? "PASS" : "FAIL"}; a Copilot session passes: ${passing(["VS Code local", "Agent Host"]) > 0 ? "PASS" : "FAIL"}; oracle disagreements with a passed self-check: ${problems.length}`);
    expect(problems).toEqual([]);
    expect(passing(["Claude Code"]), "no Claude Code session's self-check passed").toBeGreaterThan(0);
    expect(passing(["VS Code local", "Agent Host"]), "no Copilot session's self-check passed").toBeGreaterThan(0);
  });

  it("measured costs are the oracle's (Claude Code priced from the API price book, Copilot local billed AI Credits)", () => {
    const problems: string[] = [];
    let checked = 0;
    let oracleUnknown = 0;
    let totals = 0;
    let maxDiff = 0;
    for (const s of sampled.filter((x) => comparable(x) && x.candidate.kind !== "Agent Host")) {
      const name = `${s.candidate.kind} ${tag(s.candidate.id)}`;
      let sum = 0;
      let paired = 0;
      let allPriced = true;
      for (const turn of s.api.own.turns) {
        const requests = s.oracle.requests.filter((r) => r.turn === turn.turnIndex);
        if (requests.length === 0) continue;
        let expected: number | undefined;
        if (s.candidate.kind === "Claude Code") {
          const priced = priceClaudeCodeTurn(requests, s.oracle.turnStartMs[turn.turnIndex] ?? requests[0]!.atMs, tables);
          expected = priced.known ? priced.usd : undefined;
        } else {
          // The turn's billed figure is every request's, the helpers' included.
          const nanos = [...requests.map((r) => r.nanoAiu ?? null), ...s.oracle.leftOut.filter((r) => r.turn === turn.turnIndex).map((r) => r.nanoAiu)];
          if (nanos.every((n) => typeof n === "number")) expected = nanos.reduce((n: number, v) => n + (v as number), 0) / 1_000_000_000;
        }
        const cost = turn.measured.cost;
        const isPaired = cost.known && turn.simulated?.cost.known === true;
        if (expected === undefined) {
          oracleUnknown += 1;
          if (isPaired) allPriced = false;
          continue;
        }
        checked += 1;
        if (!cost.known) {
          problems.push(`${name} turn ${turn.turnIndex}: measured unknown, oracle ${expected}`);
          continue;
        }
        const basis = s.candidate.kind === "Claude Code" ? "priced" : "billed";
        if (cost.basis !== basis) problems.push(`${name} turn ${turn.turnIndex}: basis ${cost.basis}, expected ${basis}`);
        maxDiff = Math.max(maxDiff, Math.abs(cost.value - expected) / Math.max(1, Math.abs(expected)));
        if (!near(cost.value, expected)) problems.push(`${name} turn ${turn.turnIndex}: measured ${cost.value}, oracle ${expected}`);
        if (isPaired) {
          sum += expected;
          paired += 1;
        }
      }
      const total = s.api.own.totals.measured;
      if (allPriced && paired === total.knownTurns && paired > 0) {
        totals += 1;
        if (total.value === null || !near(total.value, sum)) problems.push(`${name}: measured total ${total.value}, oracle ${sum}`);
      }
    }
    say("");
    say(`Measured cost: ${checked} turns equal to the oracle within ${MONEY_TOLERANCE} relative (largest relative difference ${maxDiff.toExponential(2)}); ${oracleUnknown} turns the oracle can't price (no single-tier price version, mixed models or no billed figure); ${totals} session totals over the paired turns equal: ${problems.length === 0 ? "PASS" : `FAIL (${problems.length})`}`);
    say("  Agent Host: measured AI Credits come from session.db, not the event log; not rebuilt (reported only).");
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it("the Analyze view's data shows measured and Simulated figures side by side, with coverage and assumptions; unknown is never 0", () => {
    const problems: string[] = [];
    let replays = 0;
    for (const s of sampled) {
      const name = `${s.candidate.kind} ${tag(s.candidate.id)}`;
      for (const replay of [s.api.own, ...s.api.others]) {
        replays += 1;
        if (replay.simulated !== true) problems.push(`${name}: not labelled simulated`);
        const ids = replay.assumptions.map((a) => a.id);
        for (const id of ["A1", "A2", "A3", "A5"]) if (!ids.includes(id)) problems.push(`${name} ${replay.model}: assumption ${id} missing`);
        const unknownWrites = s.oracle.requests.some((r) => r.cacheWrite === null);
        if (s.candidate.kind === "Claude Code" && ids.includes("A4")) problems.push(`${name}: A4 on a log that records every write`);
        if (s.candidate.kind === "Agent Host" && comparable(s) && unknownWrites !== ids.includes("A4")) problems.push(`${name}: A4 ${ids.includes("A4")}, oracle unknown writes ${unknownWrites}`);
        for (const turn of replay.turns) {
          if (turn.simulated === null && !turn.notReplayedReason) problems.push(`${name}: turn ${turn.turnIndex} without figures or reason`);
          if (!turn.measured.cost.known && !turn.measured.cost.reason) problems.push(`${name}: unknown measured cost without reason`);
          if (turn.simulated && !turn.simulated.cost.known && !turn.simulated.cost.reason) problems.push(`${name}: unknown simulated cost without reason`);
        }
        for (const total of [replay.totals.measured, replay.totals.simulated]) {
          if ((total.value === null) !== (total.knownTurns === 0)) problems.push(`${name}: a total is ${total.value} over ${total.knownTurns} known turns`);
        }
        // Turns the oracle says were left out never show 0 simulated tokens.
        for (const turnIndex of comparable(s) ? s.oracle.untraced.keys() : []) {
          if (replay.turns[turnIndex]?.simulated !== null) problems.push(`${name}: turn ${turnIndex} has simulated figures but no request`);
        }
      }
      if (s.api.compare.simulated !== true) problems.push(`${name}: comparison not labelled simulated`);
    }
    say("");
    say(`Side by side: ${replays} replays (own model and two others per session) labelled Simulated, every turn with measured figures and simulated figures or a reason, A1-A3 and A5 listed (A4 never on Claude Code, exactly where Agent Host writes are unknown), unknown totals null never 0: ${problems.length === 0 ? "PASS" : `FAIL (${problems.length})`}`);
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it("Compare models ranks the models as their single replays do, with the measured total of the own-model replay", () => {
    const problems: string[] = [];
    const tally: string[] = [];
    for (const s of sampled) {
      const name = `${s.candidate.kind} ${tag(s.candidate.id)}`;
      const { compare, own, others } = s.api;
      const byModel = new Map([own, ...others].map((r) => [r.model, r]));
      for (const entry of compare.entries) {
        const single = byModel.get(entry.model);
        if (!single) problems.push(`${name}: ${entry.model} compared but not replayed`);
        else if (JSON.stringify(entry.total) !== JSON.stringify(single.totals.simulated)) problems.push(`${name}: ${entry.model} compare total ${entry.total.value}, replay ${single.totals.simulated.value}`);
      }
      if (compare.entries.length !== byModel.size) problems.push(`${name}: ${compare.entries.length} entries for ${byModel.size} models`);
      if (JSON.stringify(compare.measured) !== JSON.stringify(own.totals.measured)) problems.push(`${name}: compare measured total differs from the own-model replay's`);
      const fromCompare = rankedModels(compare.entries.map((e) => ({ model: e.model, value: e.total.value })));
      const fromReplays = rankedModels([...byModel.values()].map((r) => ({ model: r.model, value: r.totals.simulated.value })));
      if (JSON.stringify(fromCompare) !== JSON.stringify(fromReplays)) problems.push(`${name}: ranking ${fromCompare.join(">")} vs ${fromReplays.join(">")}`);
      const own0 = compare.entries[0]!;
      if (own0.model !== own.model || own0.isMeasuredModel !== (own.measuredModels.length === 1)) problems.push(`${name}: the own model isn't the first entry`);
      tally.push(fromCompare[0]!);
    }
    const cheapest = tally.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m]: (acc[m] ?? 0) + 1 }), {});
    say("");
    say(`Compare models: ${sampled.length} comparisons, each entry's total equal to its replay's, the same ranking, the own model first and the measured total the own-model replay's: ${problems.length === 0 ? "PASS" : `FAIL (${problems.length})`}; cheapest per session ${JSON.stringify(cheapest)}`);
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it("the MCP tools give the same answers as the UI's API (and the extension's for Copilot)", () => {
    const problems: string[] = [];
    let pairs = 0;
    for (const s of sampled) {
      const name = `${s.candidate.kind} ${tag(s.candidate.id)}`;
      const compareAll = (label: string, other: Answers) => {
        const sides: Array<[string, unknown, unknown]> = [
          ["own replay", s.api.own, other.own],
          ...s.api.others.map((r, i): [string, unknown, unknown] => [`replay on ${r.model}`, r, other.others[i]]),
          ["compare", s.api.compare, other.compare],
        ];
        for (const [what, a, b] of sides) {
          pairs += 1;
          if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${name}: ${label} ${what} differs from the API's`);
        }
      };
      compareAll("MCP", s.mcp);
      if (s.extension) compareAll("extension", s.extension);
    }
    say("");
    say(`MCP and UI: ${pairs} answer pairs (replay_session and compare_models_for_session against the standalone API, and the extension's API for Copilot) identical: ${problems.length === 0 ? "PASS" : `FAIL (${problems.length})`}`);
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it("no answer holds a prompt or a home path", () => {
    let answers = 0;
    let homePaths = 0;
    let prompts = 0;
    let checkedPrompts = 0;
    for (const s of sampled) {
      checkedPrompts += s.oracle.prompts.length;
      for (const answer of s.raw) {
        answers += 1;
        const found = leaksIn(answer, HOME, s.oracle.prompts);
        if (found.homePath) homePaths += 1;
        prompts += found.prompts;
      }
    }
    say("");
    say(`Privacy: ${answers} API and MCP answers searched for the home path and the opening words of ${checkedPrompts} prompts of their sessions: ${homePaths} home paths, ${prompts} prompts: ${homePaths + prompts === 0 ? "PASS" : "FAIL"}`);
    expect({ homePaths, prompts }).toEqual({ homePaths: 0, prompts: 0 });
  });

  it("changed no setting and no log", () => {
    // The run lasts many minutes beside live sessions: a log written after the run began
    // was written by its own session (log-write-check.mts); a vanished log, or a change
    // with an older write time, would be a write by this check. Settings never change.
    const report = compareLogs(logsBefore, statLogs(logs), startedAt);
    const settingsChanged = fingerprint(settingsFiles, configDirs) !== before;
    say("");
    say(`Read-only: ${logsBefore.size} raw logs by size and mtime: ${report.unchanged} unchanged, ${report.writtenDuringRun} written by their own session during the run, ${report.violations.length} changed or vanished without such a write time; settings and the app's config dir by content hash ${settingsChanged ? "CHANGED" : "unchanged"}: ${report.violations.length === 0 && !settingsChanged ? "PASS" : "FAIL"}`);
    expect(report.violations).toEqual([]);
    expect(settingsChanged, "settings changed during the run").toBe(false);
  });
});
