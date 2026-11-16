// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Phase 16: the automated half of the savings report's exit criterion
// (docs/plans/savings-report.md §14, "Automated check"), over this machine's
// own logs. Opt-in and local only:
//
//   npm run test:real-data:savings --workspace=packages/server
//   REAL_DATA_USER_DATA="<dir>,<dir>" ...   (default ~/.config/Code and "~/.config/Code - Insiders")
//
// Expected figures come from savings-oracle.mts (raw Claude Code and pi JSONL lines and
// the bundled price book and vendor-profile JSON; no code shared with the
// savings detectors or the cost pricer). Actual figures come from the two
// products' own composition roots: the standalone app's ApiService and the
// extension's, as `GET /api/savings` and the webview's `getSavingsReport` call
// them. Increment 2 (SR22): `get_savings_report` is called in-process through
// each product's MCP server (the standalone stdio server's composition, and the
// extension's createCopilotMcpServices) and must agree with those reports row
// for row. Output carries counts, hashed session ids, dates, model ids, token and
// money figures and tool or MCP-server names (cut to 40 characters), never a
// prompt, response, title, file content or path. Read-only.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { MAX_SAVINGS_NAME_LENGTH, savingsActionText, savingsReportSchema, type SavingsOpportunity, type SavingsReport } from "@agent-cost-analyzer/domain";
import { composeLogProviders, type LogProviderCompositionOptions } from "../src/composition/compose-log-providers.js";
import { createCopilotMcpServices } from "../src/composition/create-copilot-mcp-services.js";
import { createExtensionApiService } from "../src/composition/create-extension-api-service.js";
import { createStandalonePriceBook } from "../src/composition/create-price-book.js";
import { createStandaloneApiService } from "../src/composition/create-standalone-api-service.js";
import { createStandaloneAttribution } from "../src/composition/create-standalone-attribution.js";
import { createTurnPricer } from "../src/composition/create-turn-pricer.js";
import { createMcpServices } from "../src/composition/mcp-services.js";
import { loadVendorProfiles } from "../src/data-sources/vendor-profiles/loader.js";
import { createMcpServer, type McpServerDeps } from "../src/mcp/mcp-server.js";
import { DEFAULT_SAVINGS_TOOL_OPPORTUNITIES, MAX_SAVINGS_TOOL_OPPORTUNITIES, MAX_SAVINGS_TOOL_SESSIONS, type SavingsToolOutput } from "../src/mcp/savings-tool-output.js";
import { resolveCopilotHome } from "../src/data-sources/agent-host/copilot-cli-paths.js";
import { listWorkspaceDebugLogsDirPaths } from "../src/data-sources/jsonl/session-log-path.js";
import { copilotChatGlobalStoragePath } from "../src/data-sources/sqlite/copilot-chat-global-storage-path.js";
import { resolveAppSettingsDir } from "../src/platform/app-settings-dir/resolve-app-settings-dir.js";
import type { ApiService } from "../src/services/api/api-service.js";
import { InMemoryAppSettingsStore } from "../src/test-support/in-memory-app-settings-store.js";
import { FIXTURE_VENDOR_PROFILES_DIR } from "../src/test-support/vendor-profiles-dir.js";
import { activeBranchOf, idleBreaksOf, loadBundledTables, parseJsonl, piBranchesOf, piUnusedToolRowOf, requestsOf, toolSessionFactsOf, unusedToolRowOf, type OracleIdleBreak, type PiBranchFacts, type ToolSessionFacts } from "./savings-oracle.mjs";

const REAL_DATA = process.env.REAL_DATA === "1";
const HOME = homedir();
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");
const PI_AGENT = path.join(HOME, ".pi", "agent");
const PI_SESSIONS = path.join(PI_AGENT, "sessions");
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
// A prompt's first characters: long enough not to match a tool name or an id by chance.
const PROMPT_PROBE = 24;

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

// ---- the stable view of ~/.pi/agent/sessions the pi provider reads ----------

interface PiView {
  dir: string;
  // A symlink per stable session file, keeping the folder the file lives in.
  files: string[];
  live: number;
  skippedOld: number;
  targets: string[];
}

function buildPiView(now: number): PiView {
  const dir = mkdtempSync(path.join(tmpdir(), "savings-exit-pi-"));
  const view: PiView = { dir, files: [], live: 0, skippedOld: 0, targets: [] };
  if (!isDir(PI_SESSIONS)) return view;
  for (const target of listFiles(PI_SESSIONS)) {
    if (!target.toLowerCase().endsWith(".jsonl")) continue;
    const age = now - statSync(target).mtimeMs;
    if (age < LIVE_MS) {
      view.live += 1;
      continue;
    }
    if (age > VIEW_DAYS * 86_400_000) {
      view.skippedOld += 1;
      continue;
    }
    const link = path.join(dir, path.relative(PI_SESSIONS, target));
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(target, link);
    view.files.push(link);
    view.targets.push(target);
  }
  return view;
}

// The pi provider names a session sha256("<file path>:<mtimeMs>")[0..16], and a branch of
// a forked file "<that>__branch__<leaf entry id>" (the log's identity, not a cost figure).
function piSessionIdOf(file: string, branch: PiBranchFacts): string {
  const hash = createHash("sha256").update(`${file}:${statSync(file).mtimeMs}`).digest("hex").slice(0, 16);
  return branch.leafCount > 1 ? `${hash}__branch__${branch.leafId}` : hash;
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

// ---- get_savings_report through each product's MCP server (Increment 2) ----

// The standalone stdio server's composition (src/mcp/stdio.ts) over the given
// providers; no statements store, which get_savings_report does not read.
function standaloneMcpDeps(options: LogProviderCompositionOptions & { appSettingsDir: string }): McpServerDeps {
  const { registry, resolvedAppSettingsDir } = composeLogProviders(options);
  const profiles = loadVendorProfiles(FIXTURE_VENDOR_PROFILES_DIR);
  const attribution = createStandaloneAttribution(registry, resolvedAppSettingsDir, profiles);
  const priceBook = createStandalonePriceBook(resolvedAppSettingsDir, attribution.catalog);
  return {
    ...createMcpServices(registry, "0.0.0-real-data", undefined, attribution, createTurnPricer(priceBook), priceBook, undefined, { profiles, priceBook }),
    priceBook,
  };
}

interface ToolAnswer {
  structured: SavingsToolOutput;
  text: string;
  json: string;
}

async function callSavingsTool(deps: McpServerDeps, args: Record<string, unknown>): Promise<ToolAnswer> {
  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "savings-exit-real-data", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: "get_savings_report", arguments: args });
    const content = result.content as { type: string; text: string }[];
    // The error text is the tool's own fixed message, never log content.
    if (result.isError === true) throw new Error(`get_savings_report failed: ${content[0]?.text ?? "no text"}`);
    return { structured: result.structuredContent as unknown as SavingsToolOutput, text: content[0]!.text, json: JSON.stringify(result) };
  } finally {
    await client.close();
  }
}

// The tool's rows against the report the products' Savings tab shows: the same
// opportunities in the same order and rank, amounts, evidence and coverage as
// they are, the fixed action text, and the documented caps. Returns a summary.
function expectToolAgrees(label: string, report: SavingsReport, answer: ToolAnswer, limit: number): string {
  const { structured } = answer;
  const shown = Math.min(limit, report.opportunities.length);
  expect(structured.window, `${label}: window`).toEqual(report.window);
  expect(structured.pricing, `${label}: pricing`).toBe(report.pricing);
  expect(structured.opportunitiesTotal, `${label}: opportunitiesTotal`).toBe(report.opportunities.length);
  expect(structured.opportunities.length, `${label}: rows shown`).toBe(shown);
  expect(structured.includeSimulated, `${label}: includeSimulated`).toBe(false);
  expect(structured.simulated, `${label}: no Simulated rows without includeSimulated`).toEqual([]);
  expect(structured.simulatedTotal).toBe(report.simulated.length);
  let sessionsCut = 0;
  structured.opportunities.forEach((row, index) => {
    const o = report.opportunities[index]!;
    const at = `${label} row ${index + 1}`;
    expect(row.rank, `${at}: rank`).toBe(index + 1);
    expect(row.key, `${at}: key`).toBe(o.key);
    expect(row.kind, `${at}: kind`).toBe(o.kind);
    expect(row.subject, `${at}: subject`).toBe(o.subject);
    expect(row.perWeek, `${at}: per week`).toEqual(o.perWeek);
    expect(row.perWindow, `${at}: per window`).toEqual(o.perWindow);
    expect(row.evidence, `${at}: evidence`).toEqual(o.evidence);
    expect(row.coverage, `${at}: coverage`).toEqual(o.coverage);
    expect(row.inferred, `${at}: inferred`).toBe(o.inferred);
    expect(row.action, `${at}: the fixed action text`).toBe(savingsActionText(o.kind, o.actionParams));
    // D16: the report's order (largest contribution first), cut to the cap.
    expect(row.sessions, `${at}: sessions`).toEqual(o.sessions.slice(0, MAX_SAVINGS_TOOL_SESSIONS));
    expect(row.sessionsTotal, `${at}: sessionsTotal`).toBe(o.sessions.length);
    expect(row.subject.length).toBeLessThanOrEqual(MAX_SAVINGS_NAME_LENGTH);
    expect(row.key.length).toBeLessThanOrEqual(MAX_SAVINGS_NAME_LENGTH * 2);
    expect(row.action.length).toBeLessThan(600);
    expect(answer.text, `${at}: the text answer lists the row`).toContain(`${index + 1}. [${row.kind}] ${row.subject}:`);
    if (row.sessionsTotal > row.sessions.length) sessionsCut += 1;
  });
  expect(structured.notAnalysed, `${label}: not analysed`).toEqual(report.notAnalysed);
  expect(structured.sessionsLeftOut, `${label}: left out`).toEqual(report.sessionsLeftOut);
  if (shown === 0) return `no rows, as the report has none (limit ${limit})`;
  return `${shown} of ${report.opportunities.length} rows (limit ${limit}), ranks 1..${shown}, ${sessionsCut} rows with sessions cut to ${MAX_SAVINGS_TOOL_SESSIONS}`;
}

// ---- reading the oracle's side ----------------------------------------------

interface ClaudeSession {
  file: string;
  id: string;
  startedDate: string;
  breaks: OracleIdleBreak[];
  facts: ToolSessionFacts;
  // The first characters of each typed prompt, to show the tool returns none.
  // Never printed.
  promptProbes: string[];
}

function promptProbesOf(lines: readonly Record<string, unknown>[]): string[] {
  const probes: string[] = [];
  for (const line of lines) {
    if (line.type !== "user") continue;
    const content = (line.message as { content?: unknown } | undefined)?.content;
    const parts = Array.isArray(content) ? (content as { type?: unknown; text?: unknown }[]) : [];
    const texts = typeof content === "string" ? [content] : parts.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text as string);
    for (const text of texts) {
      const trimmed = text.trim();
      if (trimmed.length >= PROMPT_PROBE) probes.push(trimmed.slice(0, PROMPT_PROBE));
    }
  }
  return probes;
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
    promptProbes: promptProbesOf(lines),
  };
}

interface PiBranch {
  id: string;
  startedDate: string;
  facts: PiBranchFacts;
}

function readPiBranches(file: string): PiBranch[] {
  return piBranchesOf(parseJsonl(readFileSync(file, "utf-8"))).map((facts) => ({ id: piSessionIdOf(file, facts), startedDate: (facts.startedAt ?? "").slice(0, 10), facts }));
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
    // V27: pi's settings, model list and MCP config, and its system-prompt sidecar log
    // unless a running pi is appending to it (then it is live, like a live session file).
    ...["settings.json", "models.json", "models-store.json", "mcp.json"].map((name) => path.join(PI_AGENT, name)),
    ...[path.join(PI_AGENT, "logs", "system-prompts.jsonl")].filter((file) => existsSync(file) && startedAt - statSync(file).mtimeMs >= LIVE_MS),
  ];
  const configDirs = [appSettingsDir, path.join(HOME, ".claude", "agents"), path.join(HOME, ".claude", "skills"), path.join(HOME, ".claude", "hooks")];

  let view: ClaudeView;
  let piView: PiView;
  let piReport: SavingsReport;
  let piTool: ToolAnswer;
  const piBranches: PiBranch[] = [];
  let piWindow: PiBranch[] = [];
  let before = "";
  let stableLogs: string[] = [];
  let tmpRoot = "";
  const editions: Edition[] = [];
  const tables = loadBundledTables(path.join(FIXTURE_VENDOR_PROFILES_DIR, ".."));
  let claudeReport: SavingsReport;
  const copilotReports: { edition: Edition; standalone: SavingsReport; extension: SavingsReport }[] = [];
  let claudeTool: ToolAnswer;
  let claudeToolDefault: ToolAnswer;
  const copilotTools: { edition: Edition; report: SavingsReport; tool: ToolAnswer }[] = [];
  const claudeSessions: ClaudeSession[] = [];
  let windowSessions: ClaudeSession[] = [];
  const idByFile = new Map<string, string>();

  beforeAll(async () => {
    view = buildClaudeView(startedAt);
    piView = buildPiView(startedAt);
    tmpRoot = view.dir;
    // Stable logs whose name, size and mtime must not change: the Claude Code
    // and pi files the products read, and each edition's session debug logs older than LIVE_MS.
    stableLogs = [...view.targets, ...piView.targets];
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
    // Increment 2: the same report through the standalone MCP server, at the
    // largest limit and at the default one.
    const claudeMcp = standaloneMcpDeps({
      appSettingsDir,
      claudeCodeProjectsDirPath: view.dir,
      piAgentSessionsDirPath: null,
      mitmproxyCapturesDirPath: null,
      vscodeSettingsPath: null,
    });
    claudeTool = await callSavingsTool(claudeMcp, { provider: "claude-code", limit: MAX_SAVINGS_TOOL_OPPORTUNITIES });
    claudeToolDefault = await callSavingsTool(claudeMcp, { provider: "claude-code" });

    // V27: pi through the standalone app and its MCP server, over the stable view; the sidecar log is
    // off (its records join on the real file path, which the view's links don't have).
    const piOptions = { appSettingsDir, claudeCodeProjectsDirPath: null, piAgentSessionsDirPath: piView.dir, systemPromptLogPath: null, mitmproxyCapturesDirPath: null, vscodeSettingsPath: null };
    const piApp = createStandaloneApiService({
      ...piOptions,
      vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR,
      appVersion: "0.0.0-real-data",
      learnScriptsDir: path.join(FIXTURE_VENDOR_PROFILES_DIR, "..", "learn-scripts"),
    });
    piReport = savingsReportSchema.parse(await piApp.getSavingsReport({ provider: "pi-agent" }));
    piTool = await callSavingsTool(standaloneMcpDeps(piOptions), { provider: "pi-agent", limit: MAX_SAVINGS_TOOL_OPPORTUNITIES });

    for (const edition of editions) {
      const standalone = savingsReportSchema.parse(await edition.standalone.getSavingsReport({ provider: "vscode" }));
      const extension = savingsReportSchema.parse(await edition.extension.getSavingsReport({}));
      copilotReports.push({ edition, standalone, extension });
      // The extension's MCP server (the one Copilot Chat calls), over the same paths.
      const mcp = createCopilotMcpServices({ ...copilotPaths(edition.userData), appVersion: "0.0.0-real-data", vendorProfilesDir: FIXTURE_VENDOR_PROFILES_DIR });
      copilotTools.push({ edition, report: extension, tool: await callSavingsTool(mcp, { limit: MAX_SAVINGS_TOOL_OPPORTUNITIES }) });
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

    // The pi oracle's side: every branch of every stable pi file that could start in the pi report's window.
    const piWindowDates = piReport.window;
    for (const link of piView.files) {
      if (statSync(link).mtimeMs < sinceMs(piWindowDates.since)) continue;
      piBranches.push(...readPiBranches(link));
    }
    piWindow = piBranches.filter((b) => b.startedDate >= piWindowDates.since && b.startedDate <= piWindowDates.until);
  }, 1_800_000);

  afterAll(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    if (piView?.dir) rmSync(piView.dir, { recursive: true, force: true });
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

    // V26: the per-tool list is the oracle's, tool by tool: at most 20, largest first, each an estimate.
    const listed = row!.tools ?? [];
    expect(listed.length, "per-tool list").toBeGreaterThan(0);
    expect(listed.length, "at most 20 tools").toBeLessThanOrEqual(20);
    expect(row!.toolsTotal, "toolsTotal is the group's tool count").toBe(mine.perTool.length);
    const oracleTools = new Map(mine.perTool.map((tool) => [tool.name, tool]));
    for (const tool of listed) {
      const expected = oracleTools.get(tool.name);
      expect(expected, `tool ${tool.name} is in the oracle's group`).toBeDefined();
      expect(tool.tokens.known && tool.tokens.estimated, `${tool.name}: labeled estimate`).toBe(true);
      expect(tool.tokens.known ? Math.abs(tool.tokens.value - expected!.tokens) : Number.POSITIVE_INFINITY, `${tool.name}: tokens`).toBeLessThanOrEqual(TOKEN_TOLERANCE);
      expect(tool.sessions, `${tool.name}: sessions that loaded it`).toBe(expected!.sessions);
    }
    const tokensOf = (tool: { tokens: { known: boolean; value?: number } }) => (tool.tokens.known ? tool.tokens.value! : -1);
    expect(listed.map(tokensOf), "largest first").toEqual([...listed.map(tokensOf)].sort((a, b) => b - a));
    // The listed tools sum to the row's per-request tokens within rounding, or fall short of it by the unlisted tools.
    const sumListed = listed.reduce((sum, tool) => sum + tokensOf(tool), 0);
    if (listed.length === row!.toolsTotal) expect(Math.abs(sumListed - reportedTokens), "listed tools sum to the row").toBeLessThanOrEqual(TOKEN_TOLERANCE * listed.length + listed.length);
    else expect(sumListed, "listed tools do not exceed the row (more than rounding)").toBeLessThanOrEqual(reportedTokens + listed.length);

    say("");
    say(`Unused-tool row "${short(row!.key)}": ${row!.evidence.sessions} sessions loaded it, ${row!.evidence.requests} requests, ${reportedTokens} tokens (estimate) in each request`);
    say(`  report: ${money(row!.perWindow.low)}..${money(row!.perWindow.high)} ${row!.perWindow.currency} over ${claudeReport.window.days} days (${money(row!.perWeek.low)}..${money(row!.perWeek.high)} a week), basis ${row!.perWindow.basis}, label ${row!.perWindow.label}, coverage ${row!.coverage.sessionsAnalysed} of ${row!.coverage.sessionsInWindow} sessions`);
    say(`  oracle: ${money(mine.low)}..${money(mine.high)} USD, ${mine.requests} requests, ${mine.tokensPerSession} tokens; ran in no window session; |diff| ${Math.abs(row!.perWindow.high - mine.high).toExponential(2)}`);
    say(`  per tool: ${listed.length} of ${row!.toolsTotal} tools listed, largest ${listed[0]?.name} (${tokensOf(listed[0]!)} tokens in ${listed[0]?.sessions} sessions), each equal to the oracle's within ${TOKEN_TOLERANCE} tokens`);
    say(`  by hand: low = tokens x cache-read rate x requests, high = tokens x input rate x requests, per model at the session's first request (rates in ${row!.perWindow.priceVersionIds.length} price versions: ${row!.perWindow.priceVersionIds.join(", ")})`);
  });

  it("the window holds at least one pi session (D30), and pi sessions with system messages are not under 'no tool inventory'", () => {
    const withInventory = piWindow.filter((b) => b.facts.declared !== undefined);
    const sidecarOnly = piWindow.filter((b) => b.facts.declared === undefined);
    expect(
      piWindow.length,
      "no pi session in the window: capture one (plan D30): run pi on a local model for a linear session with a pause longer than 5 minutes and a tool left unused, then run this check again",
    ).toBeGreaterThan(0);

    const noInventory = piReport.notAnalysed.filter((n) => n.kind === "unused-tools" && n.reason.includes("no tool inventory")).reduce((sum, n) => sum + n.sessions, 0);
    // D29: exactly the sessions without a system message (the sidecar has names, no definitions) stay under Not analysed. // codespell:ignore analysed
    expect(noInventory, "sessions listed under 'no tool inventory'").toBe(sidecarOnly.length);
    const changed = withInventory.filter((b) => [...b.facts.declared!.values()].some((tool) => tool.loadedRequests !== b.facts.ownRequests));
    const forked = piWindow.filter((b) => b.facts.sharedPrefixRequests > 0);
    say("");
    say(`pi: ${piView.files.length} session files in the stable view (${piView.live} live files left out, ${piView.skippedOld} older than ${VIEW_DAYS} days left out); ${piBranches.length} branches read, ${piWindow.length} started in the window`);
    say(`  ${withInventory.length} with system messages (a tool inventory), ${sidecarOnly.length} without (D29: Not analysed, ${noInventory} so listed); ${changed.length} changed their tool list between requests; ${forked.length} forked branches sharing a prefix (D27)`); // codespell:ignore analysed
    say(`  ${piReport.opportunities.length} ranked rows ${JSON.stringify(piReport.opportunities.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.kind]: (acc[o.kind] ?? 0) + 1 }), {}))}`);
  });

  it("the top pi unused-tools row equals the oracle's rebuild from the raw pi logs (sessions, requests, tokens per request, per-tool tokens, money)", () => {
    const row = piReport.opportunities.find((o) => o.kind === "unused-tools");
    expect(row, "no pi unused-tools row in the window: nothing to check (capture an unused tool, plan D30)").toBeDefined();
    const subject = String(row!.actionParams.group);
    const bucket = row!.key.endsWith(":unpriced") ? "unpriced" : "priced";
    const mine = piUnusedToolRowOf(subject, piWindow.map((b) => b.facts), tables, bucket);
    const idOfBranch = new Map(piWindow.map((b) => [b.facts, b.id]));

    expect(mine.ran, `${subject} ran in a window session, so it is not unused`).toBe(false);
    expect(new Set(row!.sessions.map((s) => s.sessionId)), "same sessions").toEqual(new Set(mine.branches.map((b) => idOfBranch.get(b))));
    expect(row!.evidence.sessions, "sessions that declared it").toBe(mine.sessions);
    expect(row!.evidence.requests, "requests").toBe(mine.requests);
    const reportedTokens = row!.evidence.tokens?.known ? row!.evidence.tokens.value : -1;
    expect(Math.abs(mine.tokensPerSession - reportedTokens), "tokens per request").toBeLessThanOrEqual(TOKEN_TOLERANCE);
    expect(row!.evidence.tokens?.known && row!.evidence.tokens.estimated, "labeled estimate").toBe(true);

    const listed = row!.tools ?? [];
    expect(listed.length, "per-tool list").toBeGreaterThan(0);
    expect(listed.length, "at most 20 tools").toBeLessThanOrEqual(20);
    expect(row!.toolsTotal, "toolsTotal is the group's tool count").toBe(mine.perTool.length);
    const oracleTools = new Map(mine.perTool.map((tool) => [tool.name, tool]));
    for (const tool of listed) {
      const expected = oracleTools.get(tool.name);
      expect(expected, `tool ${tool.name} is in the oracle's group`).toBeDefined();
      expect(tool.tokens.known && tool.tokens.estimated, `${tool.name}: labeled estimate`).toBe(true);
      expect(tool.tokens.known ? Math.abs(tool.tokens.value - expected!.tokens) : Number.POSITIVE_INFINITY, `${tool.name}: tokens`).toBeLessThanOrEqual(TOKEN_TOLERANCE);
      expect(tool.sessions, `${tool.name}: sessions that declared it`).toBe(expected!.sessions);
    }
    const tokensOf = (tool: { tokens: { known: boolean; value?: number } }) => (tool.tokens.known ? tool.tokens.value! : -1);
    expect(listed.map(tokensOf), "largest first").toEqual([...listed.map(tokensOf)].sort((a, b) => b - a));

    // Money: Not priced (with a reason) for a model no price book lists, else the oracle's range.
    if (bucket === "unpriced") {
      expect(row!.perWindow.known || row!.perWeek.known, "an unpriced row shows no amount").toBe(false);
      if (!row!.perWindow.known) expect(row!.perWindow.reason.length, "Not priced without a reason").toBeGreaterThan(0);
      expect(row!.sessions.every((s) => s.perWindow?.known === false), "every session of an unpriced row is Not priced").toBe(true);
    } else {
      expect(row!.perWindow.known && row!.perWeek.known).toBe(true);
      if (row!.perWindow.known) {
        expect(near(row!.perWindow.low, mine.low), `window low ${row!.perWindow.low} vs ${mine.low}`).toBe(true);
        expect(near(row!.perWindow.high, mine.high), `window high ${row!.perWindow.high} vs ${mine.high}`).toBe(true);
      }
    }

    say("");
    say(`pi unused-tools row "${short(row!.key)}": ${row!.evidence.sessions} sessions declared it, ${row!.evidence.requests} requests, ${reportedTokens} tokens (estimate) in each request, coverage ${row!.coverage.sessionsAnalysed} of ${row!.coverage.sessionsInWindow} sessions`);
    say(`  oracle: ${mine.sessions} sessions, ${mine.requests} requests, ${mine.tokensPerSession} tokens, ran in no window session; same session ids; ${bucket === "unpriced" ? "money Not priced on both sides (no price for the model)" : `${money(mine.low)}..${money(mine.high)} USD`}`);
    say(`  per tool: ${listed.length} of ${row!.toolsTotal} tools listed, each equal to the oracle's within ${TOKEN_TOLERANCE} tokens`);
  });

  it("get_savings_report lists pi's rows as the standalone report does (Increment 2)", () => {
    say("");
    say(`get_savings_report, pi (standalone MCP server): ${expectToolAgrees("pi", piReport, piTool, MAX_SAVINGS_TOOL_OPPORTUNITIES)}`);
  });

  it("get_savings_report lists the same ranked opportunities as the products' reports, capped, with no prompt text (Increment 2)", () => {
    say("");
    say(`get_savings_report, Claude Code (standalone MCP server): ${expectToolAgrees("Claude Code", claudeReport, claudeTool, MAX_SAVINGS_TOOL_OPPORTUNITIES)}`);
    say(`  default limit: ${expectToolAgrees("Claude Code, default limit", claudeReport, claudeToolDefault, DEFAULT_SAVINGS_TOOL_OPPORTUNITIES)}`);
    for (const { edition, report, tool } of copilotTools) {
      say(`get_savings_report, Copilot ${edition.name} (extension MCP server): ${expectToolAgrees(`Copilot ${edition.name}`, report, tool, MAX_SAVINGS_TOOL_OPPORTUNITIES)}`);
    }
    if (copilotTools.length === 0) say("get_savings_report, Copilot: NOT CHECKED, no VS Code user-data dir on this machine");

    // No prompt text and no local path in what the model gets.
    const probes = [...new Set(windowSessions.flatMap((s) => s.promptProbes))];
    for (const answer of [claudeTool, claudeToolDefault, ...copilotTools.map((t) => t.tool)]) {
      const leaked = probes.filter((probe) => answer.json.includes(JSON.stringify(probe).slice(1, -1)));
      expect(leaked.length, `${leaked.length} prompt beginnings found in the tool's answer`).toBe(0);
      expect(answer.json.includes(HOME), "a home-directory path in the tool's answer").toBe(false);
    }
    say(`  no prompt text: ${probes.length} distinct prompt beginnings (${PROMPT_PROBE} characters) of the window's Claude Code sessions, none in any answer; no home-directory path`);
  });

  it("get_savings_report lists a row's sessions largest contribution first (D16), checked on the idle-expiry row against the oracle", () => {
    const index = claudeTool.structured.opportunities.findIndex((o) => o.kind === "idle-cache-expiry");
    expect(index, "no idle-expiry row in the tool's answer").toBeGreaterThanOrEqual(0);
    const row = claudeTool.structured.opportunities[index]!;
    const ttl = Number(claudeReport.opportunities[index]!.actionParams.minutes);
    const bySession = new Map<string, number>();
    for (const s of windowSessions) {
      for (const b of s.breaks) if (b.ttlMinutes === ttl && b.cost.known) bySession.set(s.id, (bySession.get(s.id) ?? 0) + b.cost.high);
    }
    const highs = row.sessions.map((ref) => bySession.get(ref.sessionId) ?? -1);
    for (let i = 1; i < highs.length; i++) {
      expect(highs[i]! <= highs[i - 1]! + TOLERANCE * Math.max(1, highs[i - 1]!), `session ${i + 1} contributes more than session ${i}`).toBe(true);
    }
    // A session with no priced break has no contribution and goes last (-1 here).
    const expected = [...[...bySession.values()].sort((a, b) => b - a), ...highs.map(() => -1)].slice(0, row.sessions.length);
    highs.forEach((high, i) => expect(near(high, expected[i]!), `session ${i + 1}: ${high} vs the oracle's ${expected[i]}`).toBe(true));
    // V24: each shown session's own saving is the oracle's sum of that session's priced breaks, and its date is given.
    row.sessions.forEach((ref, i) => {
      expect(ref.startedAt, `session ${i + 1}: date`).toBeDefined();
      const theirs = bySession.get(ref.sessionId);
      if (theirs !== undefined) {
        expect(ref.perWindow?.known, `session ${i + 1}: saving is known`).toBe(true);
        if (ref.perWindow?.known) expect(near(ref.perWindow.high, theirs), `session ${i + 1}: saving ${ref.perWindow.high} vs the oracle's ${theirs}`).toBe(true);
      }
    });
    say(`  D16 order: the idle-expiry row's ${row.sessions.length} sessions shown (of ${row.sessionsTotal}) are the oracle's largest, in order (top ${money(highs[0] ?? 0)} USD)`);
  });

  it("changed no setting and no file", () => {
    const after = fingerprint(settingsFiles, configDirs, stableLogs);
    const changed = before.split("\n").filter((line, i) => line !== after.split("\n")[i]);
    expect(after === before, `files changed: ${changed.map((l) => path.basename(l.split("|")[0]!)).join(", ")}`).toBe(true);
    const files = before.split("\n").length;
    say("");
    say(`Read-only: ${files} fingerprints (settings and config files by content hash, ${stableLogs.length} session logs by size and mtime) identical before and after`);
    say(`  pi (V27): ${piView.targets.length} stable session files by name, size and mtime; ~/.pi/agent settings.json, models.json, models-store.json, mcp.json and the system-prompt log (when no pi is appending to it) by content hash`);
    say(`  settings checked: ~/.claude/settings(.local).json, CLAUDE.md, ~/.claude.json, ${userDataDirs.length} VS Code settings.json, the app config dir (${path.basename(appSettingsDir)}, including settings.json with the active provider), ~/.claude agents, skills, hooks`);
    say("  D15: the report never calls 'Open in Analyze'; the app's active-provider state sits in the app config dir, so it is inside the check and unchanged");
    say("");
    say("Copilot oracle: none, see the Copilot lines above for what the window holds.");
  });
});
