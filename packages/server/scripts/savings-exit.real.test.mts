// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Phase 16: the automated half of the savings report's exit criterion
// (docs/plans/savings-report.md §14, "Automated check"), over this machine's
// own logs. Opt-in and local only:
//
//   npm run test:real-data:savings --workspace=packages/server
//   REAL_DATA_USER_DATA="<dir>,<dir>" ...   (default ~/.config/Code and "~/.config/Code - Insiders")
//
// Expected figures come from savings-oracle.mts (raw Claude Code JSONL lines and
// the bundled price book and vendor-profile JSON; no code shared with the
// savings detectors or the cost pricer). Actual figures come from the two
// products' own composition roots: the standalone app's ApiService and the
// extension's, as `GET /api/savings` and the webview's `getSavingsReport` call
// them. Output carries counts, hashed session ids, dates, model ids, token and
// money figures and tool or MCP-server names (cut to 40 characters), never a
// prompt, response, title, file content or path. Read-only.
//
// Not covered: Increment 2's `get_savings_report` MCP tool (it does not exist yet).
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { savingsReportSchema, type SavingsOpportunity, type SavingsReport } from "@agent-cost-analyzer/domain";
import { createExtensionApiService } from "../src/composition/create-extension-api-service.js";
import { createStandaloneApiService } from "../src/composition/create-standalone-api-service.js";
import { resolveCopilotHome } from "../src/data-sources/agent-host/copilot-cli-paths.js";
import { listWorkspaceDebugLogsDirPaths } from "../src/data-sources/jsonl/session-log-path.js";
import { copilotChatGlobalStoragePath } from "../src/data-sources/sqlite/copilot-chat-global-storage-path.js";
import { resolveAppSettingsDir } from "../src/platform/app-settings-dir/resolve-app-settings-dir.js";
import type { ApiService } from "../src/services/api/api-service.js";
import { InMemoryAppSettingsStore } from "../src/test-support/in-memory-app-settings-store.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../src/test-support/vendor-profiles-dir.js";
import { activeBranchOf, idleBreaksOf, loadBundledTables, parseJsonl, requestsOf, toolSessionFactsOf, unusedToolRowOf, type OracleIdleBreak, type ToolSessionFacts } from "./savings-oracle.mjs";

const REAL_DATA = process.env.REAL_DATA === "1";
const HOME = homedir();
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");
const defaultDirs = [path.join(HOME, ".config", "Code"), path.join(HOME, ".config", "Code - Insiders")];
const userDataDirs = (process.env.REAL_DATA_USER_DATA?.split(",").map((d) => d.trim()).filter(Boolean) ?? defaultDirs).filter((d) => isDir(d));

// "Equal within rounding": both sides are deterministic arithmetic over the same
// tokens and prices, so only floating-point summation order may differ. A
// relative 1e-9 (absolute 1e-9 below 1) is a billionth of the figure, far
// finer than the cent a screen rounds to.
const TOLERANCE = 1e-9;
const TOKEN_TOLERANCE = 0; // token counts are integers: exact.
// A file written this recently is a live session: its id (path + mtime) and its
// content move while the report is built, so it is left out of the view the
// products read (and reported), not compared.
const LIVE_MS = 15 * 60_000;
// A session that starts inside the window has an mtime no earlier than its start.
const VIEW_DAYS = 32;
const USD_PER_AI_CREDIT = 0.01;

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const skipReason = !REAL_DATA ? "set REAL_DATA=1 to run" : !isDir(CLAUDE_PROJECTS) ? "no ~/.claude/projects directory" : null;

const near = (actual: number, expected: number) => Math.abs(actual - expected) <= TOLERANCE * Math.max(1, Math.abs(expected));
const money = (n: number) => n.toFixed(4);
const short = (s: string) => (s.length > 40 ? `${s.slice(0, 37)}...` : s);
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

// ---- the files the app could touch, before and after ------------------------

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
      const stat = lstatSync(full);
      if (stat.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

// Content hashes of the settings the app, Claude Code and VS Code read, plus the
// app's own config folder (which holds D15's active-provider choice); name, size
// and mtime of the session logs that were stable when the run began.
function fingerprint(settingsFiles: string[], configDirs: string[], stableLogs: string[]): string {
  const lines: string[] = [];
  for (const file of settingsFiles) lines.push(`${file}|${existsSync(file) ? sha256(file) : "absent"}`);
  for (const dir of configDirs) {
    lines.push(`${dir}|${isDir(dir) ? "present" : "absent"}`);
    for (const file of listFiles(dir)) lines.push(`${file}|${sha256(file)}`);
  }
  for (const file of stableLogs) {
    const s = statSync(file);
    lines.push(`${file}|${s.size}|${s.mtimeMs}`);
  }
  return lines.join("\n");
}

// ---- the stable view of ~/.claude/projects the products read ----------------

interface ClaudeView {
  dir: string;
  // A symlink per stable session file; the products stat and read through it.
  files: string[];
  live: number;
  skippedOld: number;
  targets: string[];
}

function buildClaudeView(now: number): ClaudeView {
  const dir = mkdtempSync(path.join(tmpdir(), "savings-exit-claude-"));
  const files: string[] = [];
  const targets: string[] = [];
  let live = 0;
  let skippedOld = 0;
  for (const project of readdirSync(CLAUDE_PROJECTS)) {
    const projectDir = path.join(CLAUDE_PROJECTS, project);
    if (!isDir(projectDir)) continue;
    for (const name of readdirSync(projectDir)) {
      const target = path.join(projectDir, name);
      if (!name.toLowerCase().endsWith(".jsonl") || !statSync(target).isFile()) continue;
      const age = now - statSync(target).mtimeMs;
      if (age < LIVE_MS) {
        live += 1;
        continue;
      }
      if (age > VIEW_DAYS * 86_400_000) {
        skippedOld += 1;
        continue;
      }
      mkdirSync(path.join(dir, project), { recursive: true });
      const link = path.join(dir, project, name);
      symlinkSync(target, link);
      files.push(link);
      targets.push(target);
    }
  }
  return { dir, files, live, skippedOld, targets };
}

// The products name a Claude Code session by sha256("<file path>:<mtimeMs>")[0..16].
// The oracle must find a report row's file again, so this derivation is repeated
// here (it is the log's identity, not a cost figure).
const sessionIdOf = (file: string) => createHash("sha256").update(`${file}:${statSync(file).mtimeMs}`).digest("hex").slice(0, 16);

// ---- the two products over one Copilot user-data dir ------------------------

interface Edition {
  name: string;
  userData: string;
  standalone: ApiService;
  extension: ApiService;
}

function copilotPaths(userData: string) {
  return {
    sessionStoreDbPath: copilotChatGlobalStoragePath(userData, "session-store.db"),
    debugLogsDirPaths: listWorkspaceDebugLogsDirPaths({ userDataDir: userData }),
    agentTracesDbPath: copilotChatGlobalStoragePath(userData, "agent-traces.db"),
    agentHostUserDataDir: userData,
    // As the extension composes it (composition.ts): the Copilot CLI home, resolved as the CLI does.
    copilotHome: resolveCopilotHome(),
  };
}

function composeEdition(userData: string, appSettingsDir: string): Edition {
  const paths = copilotPaths(userData);
  const common = { vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR, appVersion: "0.0.0-real-data" };
  // The standalone app over this edition only: the other providers are switched
  // off, so its Copilot report is comparable with the extension's.
  const standalone = createStandaloneApiService({
    ...paths,
    ...common,
    vscodeSettingsPath: null,
    appSettingsDir,
    claudeCodeProjectsDirPath: null,
    piAgentSessionsDirPath: null,
    mitmproxyCapturesDirPath: null,
    learnScriptsDir: path.join(FIXTURE_VENDOR_PROFILES_DIR, "..", "learn-scripts"),
  });
  const extension = createExtensionApiService({
    ...paths,
    ...common,
    vscodeSettingsPath: null,
    appSettings: new InMemoryAppSettingsStore(),
    learnScriptsDir: path.join(FIXTURE_VENDOR_PROFILES_DIR, "..", "learn-scripts"),
  });
  return { name: path.basename(userData), userData, standalone, extension };
}

// ---- reading the oracle's side ----------------------------------------------

interface ClaudeSession {
  file: string;
  id: string;
  startedDate: string;
  breaks: OracleIdleBreak[];
  facts: ToolSessionFacts;
}

const sinceMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

function readClaudeSession(file: string, tables: ReturnType<typeof loadBundledTables>): ClaudeSession {
  const lines = parseJsonl(readFileSync(file, "utf-8"));
  const branch = activeBranchOf(lines);
  const starts = branch.map((l) => l.timestamp).filter((t): t is string => typeof t === "string");
  const started = starts.length > 0 ? starts.reduce((a, b) => (b < a ? b : a)) : "";
  return {
    file,
    id: sessionIdOf(file),
    startedDate: started.slice(0, 10),
    breaks: idleBreaksOf(requestsOf(branch), tables),
    facts: toolSessionFactsOf(lines),
  };
}

const KIND_LABELS: Record<SavingsOpportunity["kind"], string[]> = {
  "unused-tools": ["range"],
  "idle-cache-expiry": ["upper-bound"],
  "unexplained-cache-break": ["upper-bound"],
  "model-switch": ["upper-bound"],
  "failed-tool-calls": ["upper-bound"],
  "cheaper-model": ["simulated"],
};

const summary: string[] = [];
// Printed once, by afterAll, so a failing run still shows what was found.
const say = (line: string) => {
  summary.push(line);
};

(skipReason === null ? describe : describe.skip)(`Savings exit criterion, real data${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  const startedAt = Date.now();
  const appSettingsDir = resolveAppSettingsDir();
  const settingsFiles = [
    path.join(HOME, ".claude", "settings.json"),
    path.join(HOME, ".claude", "settings.local.json"),
    path.join(HOME, ".claude", "CLAUDE.md"),
    path.join(HOME, ".claude.json"),
    ...userDataDirs.map((d) => path.join(d, "User", "settings.json")),
  ];
  const configDirs = [appSettingsDir, path.join(HOME, ".claude", "agents"), path.join(HOME, ".claude", "skills"), path.join(HOME, ".claude", "hooks")];

  let view: ClaudeView;
  let before = "";
  let stableLogs: string[] = [];
  let tmpRoot = "";
  const editions: Edition[] = [];
  const tables = loadBundledTables(path.join(FIXTURE_VENDOR_PROFILES_DIR, ".."));
  let claudeReport: SavingsReport;
  const copilotReports: { edition: Edition; standalone: SavingsReport; extension: SavingsReport }[] = [];
  const claudeSessions: ClaudeSession[] = [];
  let windowSessions: ClaudeSession[] = [];
  const idByFile = new Map<string, string>();

  beforeAll(async () => {
    view = buildClaudeView(startedAt);
    tmpRoot = view.dir;
    // Stable logs whose name, size and mtime must not change: the Claude Code
    // files the products read, and each edition's session debug logs older than LIVE_MS.
    stableLogs = [...view.targets];
    for (const userData of userDataDirs) {
      for (const root of listWorkspaceDebugLogsDirPaths({ userDataDir: userData })) {
        for (const file of listFiles(root)) if (startedAt - statSync(file).mtimeMs >= LIVE_MS) stableLogs.push(file);
      }
    }
    before = fingerprint(settingsFiles, configDirs, stableLogs);

    for (const userData of userDataDirs) editions.push(composeEdition(userData, appSettingsDir));
    // Claude Code through the standalone app (the extension has no such provider, D10).
    const claudeApp = createStandaloneApiService({
      appSettingsDir,
      vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR,
      appVersion: "0.0.0-real-data",
      claudeCodeProjectsDirPath: view.dir,
      piAgentSessionsDirPath: null,
      mitmproxyCapturesDirPath: null,
      vscodeSettingsPath: null,
      learnScriptsDir: path.join(FIXTURE_VENDOR_PROFILES_DIR, "..", "learn-scripts"),
    });
    claudeReport = savingsReportSchema.parse(await claudeApp.getSavingsReport({ provider: "claude-code" }));

    for (const edition of editions) {
      const standalone = savingsReportSchema.parse(await edition.standalone.getSavingsReport({ provider: "vscode" }));
      const extension = savingsReportSchema.parse(await edition.extension.getSavingsReport({}));
      copilotReports.push({ edition, standalone, extension });
    }

    // The oracle's side: every stable session file that could start in the window.
    const { since, until } = claudeReport.window;
    for (const link of view.files) {
      if (statSync(link).mtimeMs < sinceMs(since)) continue;
      const read = readClaudeSession(link, tables);
      idByFile.set(link, read.id);
      claudeSessions.push(read);
    }
    windowSessions = claudeSessions.filter((s) => s.startedDate >= since && s.startedDate <= until);
  }, 1_800_000);

  afterAll(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    console.log(["", "Savings exit-criterion summary (automated half)", ...summary].join("\n"));
  });

  it("reports the machine and the window", () => {
    const { since, until, days } = claudeReport.window;
    say(`window: ${since}..${until} (${days} days), pricing ${claudeReport.pricing}`);
    say(`Claude Code: ${view.files.length} session files in the stable view (${view.live} live files left out, ${view.skippedOld} older than ${VIEW_DAYS} days left out); ${windowSessions.length} sessions started in the window`);
    say(`Copilot: ${editions.length} VS Code editions found (${editions.map((e) => e.name).join(", ") || "none"})`);
    expect(windowSessions.length, "no Claude Code session in the window: nothing to check").toBeGreaterThan(0);
  });

  it("the standalone app and the extension list the same ranked Copilot opportunities (same labels and coverage)", () => {
    if (copilotReports.length === 0) {
      say("Copilot parity: NOT CHECKED, no VS Code user-data dir on this machine");
      return;
    }
    for (const { edition, standalone, extension } of copilotReports) {
      const kinds = extension.opportunities.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.kind]: (acc[o.kind] ?? 0) + 1 }), {});
      const left = extension.notAnalysed.reduce((sum, n) => sum + n.sessions, 0);
      say(`Copilot ${edition.name}: standalone ${standalone.opportunities.length} ranked rows, extension ${extension.opportunities.length}; kinds ${JSON.stringify(kinds)}; ${left} session-reasons not analysed`);
      expect(extension.window).toEqual(standalone.window);
      expect(extension.opportunities.map((o) => o.key)).toEqual(standalone.opportunities.map((o) => o.key));
      expect(extension, `${edition.name}: the two products' reports differ`).toEqual(standalone);
    }
    const copilotRows = copilotReports.flatMap((r) => r.extension.opportunities);
    if (copilotRows.length === 0) say("Copilot: no ranked opportunity in the window on this machine (parity holds trivially)");
    const checked = (kind: SavingsOpportunity["kind"]) => copilotRows.filter((o) => o.kind === kind).length;
    say(`Copilot rows of the two hand-checked kinds: idle-expiry ${checked("idle-cache-expiry")}, unused-tools ${checked("unused-tools")}; so both hand checks below are on Claude Code`);
  });

  it("every opportunity names its basis, a range or 'up to' label and its coverage; the list is ranked by the high end", () => {
    const reports = [claudeReport, ...copilotReports.flatMap((r) => [r.standalone, r.extension])];
    for (const report of reports) {
      for (const o of report.opportunities) {
        for (const amount of [o.perWeek, o.perWindow]) {
          if (!amount.known) {
            expect(amount.reason.length, `${o.key}: unknown amount without a reason`).toBeGreaterThan(0);
            continue;
          }
          expect(amount.basis, o.key).toBe("priced");
          expect(KIND_LABELS[o.kind], `${o.key}: label ${amount.label}`).toContain(amount.label);
          expect(amount.priceVersionIds.length, `${o.key}: no price version`).toBeGreaterThan(0);
        }
        expect(o.coverage.sessionsInWindow, o.key).toBeGreaterThanOrEqual(o.coverage.sessionsAnalysed);
        expect(o.coverage.sessionsInWindow, `${o.key}: coverage of an empty window`).toBeGreaterThan(0);
      }
      const usd = (o: SavingsOpportunity) => (o.perWindow.known ? o.perWindow.high * (o.perWindow.currency === "USD" ? 1 : USD_PER_AI_CREDIT) : null);
      const highs = report.opportunities.map(usd);
      const knownThenUnknown = [...highs.filter((h) => h !== null), ...highs.filter((h) => h === null)];
      expect(highs, "unpriced rows come last").toEqual(knownThenUnknown);
      const known = highs.filter((h): h is number => h !== null);
      expect(known, "ranked by the high end, descending").toEqual([...known].sort((a, b) => b - a));
    }
    const kinds = claudeReport.opportunities.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.kind]: (acc[o.kind] ?? 0) + 1 }), {});
    say(`Claude Code report: ${claudeReport.opportunities.length} ranked rows ${JSON.stringify(kinds)}; coverage of the top row: ${JSON.stringify(claudeReport.opportunities[0]?.coverage.sessionsAnalysed)} of ${claudeReport.opportunities[0]?.coverage.sessionsInWindow} sessions`);
  });

  it("the top idle-expiry row equals the oracle's rebuild from the raw logs (count, lost tokens, extra cost), and its biggest break is shown", () => {
    const row = claudeReport.opportunities.find((o) => o.kind === "idle-cache-expiry");
    expect(row, "no idle-expiry opportunity in the window: nothing to check").toBeDefined();
    const ttl = Number(row!.actionParams.minutes);
    const mine = windowSessions.flatMap((s) => s.breaks.filter((b) => b.ttlMinutes === ttl).map((b) => ({ session: s, brk: b })));
    const priced = mine.filter((m) => m.brk.cost.known);
    const lost = mine.reduce((sum, m) => sum + m.brk.lostTokens, 0);
    const high = priced.reduce((sum, m) => sum + (m.brk.cost.known ? m.brk.cost.high : 0), 0);
    const rowSessionIds = new Set(row!.sessions.map((s) => s.sessionId));
    const oracleSessionIds = new Set(mine.map((m) => m.session.id));

    expect(row!.perWindow.known && row!.perWeek.known).toBe(true);
    if (!row!.perWindow.known || !row!.perWeek.known) return;
    expect(mine.length, "number of idle breaks").toBe(row!.evidence.occurrences);
    expect(lost, "lost tokens").toBe(row!.evidence.tokens?.known ? row!.evidence.tokens.value : -1);
    expect(oracleSessionIds, "sessions with a break").toEqual(rowSessionIds);
    expect(row!.perWindow.low).toBe(0);
    expect(near(row!.perWindow.high, high), `window high ${row!.perWindow.high} vs oracle ${high}`).toBe(true);
    expect(near(row!.perWeek.high, high / (claudeReport.window.days / 7)), "per-week high").toBe(true);

    const top = [...priced].sort((a, b) => (b.brk.cost.known ? b.brk.cost.high : 0) - (a.brk.cost.known ? a.brk.cost.high : 0))[0]!;
    const r = top.brk.rates!;
    const extra = top.brk.cost.known ? top.brk.cost.high : NaN;
    say("");
    say(`Idle-expiry row "${row!.key}": ${row!.evidence.occurrences} breaks in ${rowSessionIds.size} sessions, ${row!.evidence.tokens?.known ? row!.evidence.tokens.value : "?"} tokens lost`);
    say(`  report: up to ${money(row!.perWindow.high)} ${row!.perWindow.currency} over ${claudeReport.window.days} days (${money(row!.perWeek.high)} a week), low 0, basis ${row!.perWindow.basis}, label ${row!.perWindow.label}, versions ${row!.perWindow.priceVersionIds.join(",")}`);
    say(`  oracle: up to ${money(high)} USD (${priced.length} of ${mine.length} breaks priced), ${lost} tokens, same sessions; |diff| ${Math.abs(row!.perWindow.high - high).toExponential(2)}, tolerance ${TOLERANCE} relative`);
    say(`  biggest break to check by hand: session ${top.session.id}, turn ${top.brk.turn}, ${top.brk.at}, model ${top.brk.model}`);
    say(`    gap ${top.brk.gapMinutes.toFixed(1)} min > ${top.brk.ttlMinutes} min lifetime; previous prompt ${top.brk.previousPrompt}, this prompt ${top.brk.prompt}, cache read ${top.brk.cacheRead}, lost ${top.brk.lostTokens}`);
    say(`    price ${top.brk.cost.known ? top.brk.cost.versionId : "?"}: 1-hour write ${r.writeUsdPerM}/M, input ${r.inputUsdPerM}/M, cache read ${r.cacheReadUsdPerM}/M`);
    say(`    extra cost = ${top.brk.lostTokens} x (${Math.max(r.writeUsdPerM, r.inputUsdPerM)} - ${r.cacheReadUsdPerM}) / 1e6 = ${money(extra)} USD`);
  });

  it("the top unused-tool row equals the oracle's rebuild from the raw logs (tokens per request, requests, cost range)", () => {
    const row = claudeReport.opportunities.find((o) => o.kind === "unused-tools");
    expect(row, "no unused-tool opportunity in the window: nothing to check").toBeDefined();
    const subject = String(row!.actionParams.group);
    const facts = windowSessions.map((s) => s.facts);
    const mine = unusedToolRowOf(subject, facts, tables);

    expect(row!.perWindow.known && row!.perWeek.known).toBe(true);
    if (!row!.perWindow.known || !row!.perWeek.known) return;
    expect(mine.ran, `${subject} ran in a window session, so it is not unused`).toBe(false);
    expect(mine.sessions, "sessions that loaded it").toBe(row!.evidence.sessions);
    expect(mine.requests, "requests").toBe(row!.evidence.requests);
    const reportedTokens = row!.evidence.tokens?.known ? row!.evidence.tokens.value : -1;
    expect(Math.abs(mine.tokensPerSession - reportedTokens), "tokens per request").toBeLessThanOrEqual(TOKEN_TOLERANCE);
    expect(row!.evidence.tokens?.known && row!.evidence.tokens.estimated, "labelled estimate").toBe(true);
    expect(near(row!.perWindow.low, mine.low), `window low ${row!.perWindow.low} vs ${mine.low}`).toBe(true);
    expect(near(row!.perWindow.high, mine.high), `window high ${row!.perWindow.high} vs ${mine.high}`).toBe(true);
    expect(near(row!.perWeek.high, mine.high / (claudeReport.window.days / 7)), "per-week high").toBe(true);
    expect(row!.perWindow.label).toBe("range");

    say("");
    say(`Unused-tool row "${short(row!.key)}": ${row!.evidence.sessions} sessions loaded it, ${row!.evidence.requests} requests, ${reportedTokens} tokens (estimate) in each request`);
    say(`  report: ${money(row!.perWindow.low)}..${money(row!.perWindow.high)} ${row!.perWindow.currency} over ${claudeReport.window.days} days (${money(row!.perWeek.low)}..${money(row!.perWeek.high)} a week), basis ${row!.perWindow.basis}, label ${row!.perWindow.label}, coverage ${row!.coverage.sessionsAnalysed} of ${row!.coverage.sessionsInWindow} sessions`);
    say(`  oracle: ${money(mine.low)}..${money(mine.high)} USD, ${mine.requests} requests, ${mine.tokensPerSession} tokens; ran in no window session; |diff| ${Math.abs(row!.perWindow.high - mine.high).toExponential(2)}`);
    say(`  by hand: low = tokens x cache-read rate x requests, high = tokens x input rate x requests, per model at the session's first request (rates in ${row!.perWindow.priceVersionIds.length} price versions: ${row!.perWindow.priceVersionIds.join(", ")})`);
  });

  it("changed no setting and no file", () => {
    const after = fingerprint(settingsFiles, configDirs, stableLogs);
    const changed = before.split("\n").filter((line, i) => line !== after.split("\n")[i]);
    expect(after === before, `files changed: ${changed.map((l) => path.basename(l.split("|")[0]!)).join(", ")}`).toBe(true);
    const files = before.split("\n").length;
    say("");
    say(`Read-only: ${files} fingerprints (settings and config files by content hash, ${stableLogs.length} session logs by size and mtime) identical before and after`);
    say(`  settings checked: ~/.claude/settings(.local).json, CLAUDE.md, ~/.claude.json, ${userDataDirs.length} VS Code settings.json, the app config dir (${path.basename(appSettingsDir)}, including settings.json with the active provider), ~/.claude agents, skills, hooks`);
    say("  D15: the report never calls 'Open in Analyze'; the app's active-provider state sits in the app config dir, so it is inside the check and unchanged");
    say("");
    say("Not covered: Increment 2's get_savings_report MCP tool (does not exist yet). Copilot oracle: none, see the Copilot lines above for what the window holds.");
  });
});
