// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The made-up data the free demo scenes run on (docs/plans/docs-refresh-and-demo-recordings.md
// §4.1 and task 1.6a; wdio.demo.conf.mts): sessions in two git repositories over
// five weeks, one with subagent runs and a system prompt (E3, E4), unused tools,
// idle gaps and model switches for Savings (E5), a Copilot CLI session full of
// failed tool calls (E8), and a month about 82 % used against
// `allowanceForNearLimit` (E7). The `ready` variant is a set-up user's VS Code;
// `setup-problem` has Copilot's debug logging unset, so Setup has something to
// flag (E1). Nothing comes from a real machine: placeholder repositories, titles
// and prompts only. Node runs this directly (type stripping), like ui-fixture.mts.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createIntegrationFixture, USER_SETTINGS } from "../integration-fixture.mts";
import { createGitFolder } from "./git-folder.mts";
import {
  agentSessionCredits,
  classicSessionCredits,
  createAgentHostCatalog,
  writeAgentSession,
  writeClassicSession,
  type DemoAgentCall,
  type DemoAgentSession,
  type DemoClassicSession,
  type DemoClassicTurn,
  type DemoRequest,
  type DemoSubagentRun,
} from "./demo-session-writers.mts";

export type DemoVariant = "ready" | "setup-problem";

export interface DemoRepository {
  folder: string;
  path: string;
  remote: string;
  // What the Sessions view and Compare call it.
  key: string;
  name: string;
}

export interface DemoSessionRef {
  id: string;
  title: string;
}

export interface DemoFixture {
  variant: DemoVariant;
  // wdio:vscodeOptions.storagePath; the service's user-data dir is <storagePath>/settings.
  storagePath: string;
  userDataDir: string;
  // wdio:vscodeOptions.userSettings (the service overwrites User/settings.json with them).
  userSettings: Record<string, string | number | boolean | object>;
  // COPILOT_HOME for the launched VS Code: the Copilot CLI sessions' event logs.
  copilotHome: string;
  // The folder VS Code opens (the `demo` repository), so the status bar names it.
  workspacePath: string;
  repositories: { demo: DemoRepository; ledger: DemoRepository };
  // E3, E4: 10 turns, subagent runs in `subagentTurns` (0-based), a system prompt containing `systemPromptMarker`.
  readSession: DemoSessionRef & { turns: number; subagentTurns: number[] };
  systemPromptMarker: string;
  // E4: a model to replay readSession on (not the one it ran on).
  replayModel: string;
  // E5: the opportunity kinds the report holds over 30 days, and what they name.
  savings: { kinds: string[]; unusedToolsServers: string[]; failedPrograms: string[] };
  // E8: the Copilot CLI session with failed calls, the categories they fall in, and calls with no recorded outcome.
  auditSession: DemoSessionRef & { categories: string[]; unknownCalls: number };
  // E7: type this into the Settings editor; the month so far is `monthToDateCredits` of it (about 82 %).
  allowanceForNearLimit: number;
  monthToDateCredits: number;
  // The billing period starts on this day of the month, `periodStartDaysAgo` days before the run.
  resetDay: number;
  periodStartDaysAgo: number;
  // Every session the Sessions view lists.
  listedSessionCount: number;
}

export interface DemoFixtureOptions {
  variant?: DemoVariant;
  now?: Date;
}

// How the demo config hands each launch's fixture to its scenes (as JSON in the environment).
export const DEMO_FIXTURE_ENV = "AICA_DEMO_FIXTURE";
export const DEMO_SETUP_PROBLEM_FIXTURE_ENV = "AICA_DEMO_SETUP_PROBLEM_FIXTURE";

// Scene E1 (Get started) needs the problem Setup flags; every other scene a set-up user's VS Code.
export function demoVariantOfSpec(specPath: string): DemoVariant {
  return /^e1-.*\.demo\.ts$/.test(path.basename(specPath)) ? "setup-problem" : "ready";
}

// The fixture a scene finds in the environment; throws with what is wrong, so a scene
// started some other way fails with a clear message.
export function parseDemoFixture(raw: string | undefined, envName: string = DEMO_FIXTURE_ENV): DemoFixture {
  if (raw === undefined || raw === "") throw new Error(`${envName} is not set: run the scenes with \`npm run demo:record\`, which seeds the demo fixture`);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid demo fixture in ${envName}: not JSON`);
  }
  const fixture = value as Record<string, unknown> | null;
  for (const key of ["storagePath", "userDataDir", "copilotHome", "workspacePath"]) {
    if (typeof fixture?.[key] !== "string" || fixture[key] === "") throw new Error(`Invalid demo fixture in ${envName}: ${key} must be a non-empty string`);
  }
  return value as DemoFixture;
}

export const DEMO_SYSTEM_PROMPT_MARKER = "Follow the conventions of the aica-e2e/demo repository.";
const DEMO_SYSTEM_PROMPT = [
  "You are an expert AI programming assistant, working with a user in the VS Code editor.",
  DEMO_SYSTEM_PROMPT_MARKER,
  "<instructions>Keep going until the user's request is completely resolved. Prefer small, reviewable changes and run the tests after each one.</instructions>",
  "<toolUseInstructions>Read the relevant files before editing them. Use the search tools instead of guessing file names.</toolUseInstructions>",
].join("\n");

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const REPLAY_MODEL = "gpt-6.1-sol";
const MAIN_MODEL = "claude-sonnet-5";
const SWITCH_MODEL = "claude-opus-5";
const SUBAGENT_MODEL = "claude-haiku-5.5";
// Two workspace-storage folders named like a workspace id (see ui-fixture.mts: VS Code deletes the others).
const WORKSPACE_STORAGE_IDS = { demo: "a11ce5ed1f1a4e0dbf7e0c0de0000d01", ledger: "a11ce5ed1f1a4e0dbf7e0c0de0000d02" } as const;
const SETUP_PROBLEM_REMOVED = (key: string): boolean => key.startsWith("github.copilot.");
const BUILTIN_TOOLS = ["read_file", "grep_search", "replace_string_in_file", "run_in_terminal", "get_errors"];
const MCP_SERVERS = ["acmedocs", "pgtools"];
const TOOL_INVENTORY = [...BUILTIN_TOOLS, ...MCP_SERVERS.flatMap((server) => [`mcp_${server}_search`, `mcp_${server}_fetch`])];
// The period starts this many days before the run, or the next later day whose date is 1-28 (a reset day).
const PERIOD_START_DAYS_AGO = 20;
const TARGET_USED_FRACTION = 0.82;

const REPOSITORIES = { demo: { folder: "demo", remote: "https://github.com/aica-e2e/demo.git", key: "github.com/aica-e2e/demo", name: "demo" }, ledger: { folder: "ledger-service", remote: "https://github.com/aica-e2e/ledger-service.git", key: "github.com/aica-e2e/ledger-service", name: "ledger-service" } } as const;

// A small deterministic generator, so a rerun on the same day writes the same data.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

// GitHub Copilot's list prices in USD per million tokens (fixtures/price-book/github-copilot.json), so a
// request's billed AI Credits agree with what a replay prices (1 AI Credit = $0.01).
const RATES: Record<string, { write: number; cached: number; output: number }> = {
  "claude-sonnet-5": { write: 2.5, cached: 0.2, output: 10 },
  "claude-opus-5": { write: 6.25, cached: 0.5, output: 25 },
  "claude-haiku-5.5": { write: 0.125, cached: 0.01, output: 0.5 },
};

function priced(model: string, input: number, cached: number, output: number): DemoRequest {
  const rate = RATES[model]!;
  const usd = ((input - cached) * rate.write + cached * rate.cached + output * rate.output) / 1_000_000;
  return { input, cached, output, credits: Math.round(usd * 100 * 10_000) / 10_000 };
}

interface TurnSpec {
  prompt: string;
  response: string;
  model: string;
  tool: string;
  subagents?: DemoSubagentRun[];
  gapBeforeMinutes?: number;
  // The first request of the turn finds no prompt cache (an idle gap or a model switch).
  coldStart?: boolean;
}

// Two requests per turn. The prompt grows with each request, and each request reads the
// previous one's prompt from the cache unless the turn starts cold.
function assemble(specs: TurnSpec[], firstInput: number, growth: number, random: () => number): DemoClassicTurn[] {
  let previous = 0;
  let size = firstInput;
  return specs.map((spec) => {
    const requests = [0, 1].map((round) => {
      const cold = previous === 0 || (round === 0 && spec.coldStart === true);
      const input = size;
      const output = 300 + Math.floor(random() * 250);
      const built = priced(spec.model, input, cold ? 0 : previous, output);
      previous = input;
      size += growth + Math.floor(random() * 400);
      return built;
    });
    return {
      prompt: spec.prompt,
      response: spec.response,
      model: spec.model,
      requests,
      tools: [spec.tool],
      ...(spec.subagents ? { subagents: spec.subagents } : {}),
      ...(spec.gapBeforeMinutes !== undefined ? { gapBeforeMinutes: spec.gapBeforeMinutes } : {}),
    };
  });
}

const classicId = (index: number): string => `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const agentId = (index: number): string => `9a1b2c3d-5555-4e6f-8a07-${String(index + 700).padStart(12, "0")}`;
const sdkId = (index: number): string => `5d1a0${String(index).padStart(3, "0")}-aaaa-4bbb-8ccc-000000000d${String(index).padStart(2, "0")}`;

// ---- The session that E3 and E4 read ------------------------------------------

const READ_PROMPTS = [
  "Add pagination to the orders endpoint.",
  "Where is the orders query built? Explore the repository first.",
  "Add page and pageSize query parameters, with a default of 25.",
  "The limit must not exceed 100. Add validation.",
  "Plan the change to the response envelope so clients get a total count.",
  "Implement the envelope and update the handler.",
  "Write unit tests for the new parameters.",
  "Check how other endpoints name their paging fields and match them.",
  "Update the OpenAPI description.",
  "Summarise what changed for the pull request.",
];
const READ_TOOLS = ["grep_search", "read_file", "replace_string_in_file", "replace_string_in_file", "read_file", "replace_string_in_file", "run_in_terminal", "grep_search", "replace_string_in_file", "get_errors"];
// 0-based turns that start a subagent run.
const READ_SUBAGENT_TURNS = [1, 4, 7];

function subagentRun(agentName: string, rounds: number, tools: string[]): DemoSubagentRun {
  return { agentName, model: SUBAGENT_MODEL, requests: Array.from({ length: rounds }, (_, i) => priced(SUBAGENT_MODEL, 9000 + i * 1500, i === 0 ? 0 : 9000 + (i - 1) * 1500, 350)), toolNames: tools };
}

function readSessionTurns(): DemoClassicTurn[] {
  const specs = READ_PROMPTS.map<TurnSpec>((prompt, index) => ({
    prompt,
    response: `Done: ${prompt.replace(/\.$/, "").toLowerCase()}.`,
    model: MAIN_MODEL,
    tool: READ_TOOLS[index]!,
    ...(READ_SUBAGENT_TURNS.includes(index) ? { subagents: [index === 4 ? subagentRun("Plan", 2, ["read_file", "grep_search"]) : subagentRun("Explore", 3, ["grep_search", "read_file", "read_file"])] } : {}),
  }));
  return assemble(specs, 20_000, 2600, mulberry32(11));
}

// ---- A session with an idle gap and a model switch (Savings) -------------------

const IDLE_PROMPTS = ["The checkout test fails about one run in five.", "Show me the test and the code it covers.", "Add a wait for the payment callback.", "Run it twenty times to see if it still flakes.", "It passes. Try the stricter model for a second look at the race.", "Write a short note for the commit message."];

function idleSessionTurns(): DemoClassicTurn[] {
  const specs = IDLE_PROMPTS.map<TurnSpec>((prompt, index) => ({
    prompt,
    response: `Placeholder answer ${index + 1}.`,
    model: index >= 4 ? SWITCH_MODEL : MAIN_MODEL,
    tool: index % 2 === 0 ? "read_file" : "grep_search",
    // Longer than any prompt cache lives, so the next request writes the whole prompt again.
    ...(index === 3 ? { gapBeforeMinutes: 75, coldStart: true } : {}),
    // The stricter model has no cache of the first one's prompt.
    ...(index === 4 ? { coldStart: true } : {}),
  }));
  return assemble(specs, 24_000, 2200, mulberry32(23));
}

// ---- Filler sessions: the shape of five weeks --------------------------------

interface FillerSpec {
  repo: keyof typeof REPOSITORIES;
  daysAgo: number;
  title: string;
  withTools?: boolean;
}

const FILLERS: FillerSpec[] = [
  { repo: "demo", daysAgo: 3, title: "Add retry to the payment client", withTools: true },
  { repo: "demo", daysAgo: 5, title: "Document the REST endpoints", withTools: true },
  { repo: "demo", daysAgo: 8, title: "Upgrade the date library", withTools: true },
  { repo: "demo", daysAgo: 11, title: "Write tests for the coupon rules" },
  { repo: "demo", daysAgo: 15, title: "Speed up the product search" },
  { repo: "demo", daysAgo: 19, title: "Fix the timezone bug in the order export" },
  { repo: "demo", daysAgo: 24, title: "Tidy the CSS variables" },
  { repo: "demo", daysAgo: 31, title: "Add a dark mode toggle" },
  { repo: "demo", daysAgo: 38, title: "Rename the cart service" },
  { repo: "ledger", daysAgo: 2, title: "Add idempotency keys" },
  { repo: "ledger", daysAgo: 4, title: "Reconcile rounding in invoices" },
  { repo: "ledger", daysAgo: 7, title: "Migrate to async handlers" },
  { repo: "ledger", daysAgo: 10, title: "Fix the off-by-one in statements" },
  { repo: "ledger", daysAgo: 14, title: "Cache exchange rates" },
  { repo: "ledger", daysAgo: 18, title: "Add an audit log table" },
  { repo: "ledger", daysAgo: 22, title: "Review the refund flow" },
  { repo: "ledger", daysAgo: 28, title: "Split the monolith module" },
  { repo: "ledger", daysAgo: 35, title: "Add a statement PDF export" },
];

function fillerTurns(random: () => number, title: string): DemoClassicTurn[] {
  const count = 3 + Math.floor(random() * 3);
  const follow = ["Show me the current code.", "Make the change.", "Run the tests and fix what fails.", "Tidy it up."];
  const tools = ["read_file", "grep_search", "replace_string_in_file", "run_in_terminal"];
  const specs = Array.from({ length: count }, (_, index) => ({ prompt: index === 0 ? `${title}.` : follow[index - 1]!, response: "Placeholder answer.", model: MAIN_MODEL, tool: tools[index % 4]! }));
  return assemble(specs, 14_000 + Math.floor(random() * 4000), 2000, random);
}

// ---- Copilot CLI sessions (failed calls) -------------------------------------

const ok = { kind: "ok" } as const;
const failed = (exitCode: number, message: string) => ({ kind: "failed", exitCode, message }) as const;
const bash = (command: string, outcome: DemoAgentCall["outcome"]): DemoAgentCall => ({ tool: "bash", command, outcome });

// Categories the call failures below fall in (the audit's own names).
const AUDIT_CATEGORIES = ["command-not-found", "wrong-directory", "dependency-missing", "network", "permission-denied", "file-not-found", "test-or-build-failure"];

function auditSessionTurns(): DemoAgentSession["turns"] {
  const rg = (args: string) => bash(`rg -n ${args}`, failed(127, "bash: rg: command not found"));
  const curl = (file: string) => bash(`curl -sS https://registry.example.test/${file} -o ${file}`, failed(6, "curl: (6) Could not resolve host: registry.example.test"));
  return [
    { prompt: "Switch the build scripts from npm to pnpm.", reply: "Found the scripts that call npm.", credits: 1.8, calls: [rg('"npm run" scripts'), rg('"npm ci" .github'), bash("cat package.json", ok)] },
    {
      prompt: "Now the Dockerfile and the lock check.",
      reply: "The Dockerfile still installs with npm.",
      credits: 2.2,
      calls: [rg("npm Dockerfile"), bash("cd ../services && ls", failed(1, "bash: cd: ../services: No such file or directory")), bash("python3 scripts/check_lock.py", failed(1, "ModuleNotFoundError: No module named 'yaml'"))],
    },
    {
      prompt: "Download the pnpm tarball and run the release script.",
      reply: "Neither worked from here.",
      credits: 1.6,
      calls: [curl("pnpm.tgz"), curl("pnpm.sha256"), bash("./scripts/release.sh --dry-run", failed(126, "bash: ./scripts/release.sh: Permission denied"))],
    },
    {
      prompt: "Update the build docs and run the tests.",
      reply: "Three tests fail; the docs file is missing.",
      credits: 2.4,
      calls: [{ tool: "view", command: "docs/build.md", outcome: failed(1, "File does not exist: docs/build.md") }, bash("pnpm test", failed(1, "Tests:       3 failed, 41 passed, 44 total"))],
    },
    { prompt: "Fix the failing tests and show the status.", reply: "Tests pass.", credits: 1.4, calls: [bash("pnpm test", ok), bash("git status --short", { kind: "unknown" })] },
  ];
}

const dockerTurns: DemoAgentSession["turns"] = [
  { prompt: "Bump the Dockerfile base image to the current LTS.", reply: "Updated the FROM line.", credits: 1.5, calls: [bash("rg -n FROM Dockerfile", failed(127, "bash: rg: command not found")), bash("sed -i 's/node:20/node:22/' Dockerfile", ok)] },
  { prompt: "Build it and check the size.", reply: "The image builds.", credits: 1.1, calls: [bash("docker build -t ledger .", ok)] },
];

// ---- Assembly ----------------------------------------------------------------

function localDayKey(date: Date): string {
  return date.toLocaleDateString("en-CA");
}

// Today's sessions start up to this many minutes before the run.
const TODAY_SPAN_MINUTES = 80;

// A start `daysAgo` days back on the local calendar, at a mid-morning hour (so never in the future);
// today's sessions start `minutesAgo` minutes before the run, squeezed into the time since local
// midnight when the run starts less than TODAY_SPAN_MINUTES after it (so they stay on today).
function startOf(now: Date, daysAgo: number, slot: number, minutesAgo: number): Date {
  if (daysAgo === 0) {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const sinceMidnight = Math.max(now.getTime() - midnight.getTime() - 1_000, 0);
    const scale = Math.min(1, sinceMidnight / (TODAY_SPAN_MINUTES * MINUTE_MS));
    return new Date(now.getTime() - minutesAgo * MINUTE_MS * scale);
  }
  const day = new Date(now);
  day.setDate(day.getDate() - daysAgo);
  day.setHours(9 + (slot % 8), (slot * 7) % 60, 0, 0);
  return day;
}

// The billing period's reset day: 1-28 on a date `PERIOD_START_DAYS_AGO` days back, or the next later date that is.
function periodStart(now: Date): { resetDay: number; daysAgo: number } {
  for (let daysAgo = PERIOD_START_DAYS_AGO; daysAgo > 0; daysAgo--) {
    const date = new Date(now.getTime() - daysAgo * DAY_MS);
    if (date.getDate() <= 28) return { resetDay: date.getDate(), daysAgo };
  }
  throw new Error("no reset day found");
}

export function createDemoFixture(rootDir: string, options: DemoFixtureOptions = {}): DemoFixture {
  const now = options.now ?? new Date();
  const variant = options.variant ?? "ready";

  // The base builds the VS Code user-data layout; its own sessions are dropped below, so only this file's data is listed.
  const base = createIntegrationFixture(rootDir, { sessionCount: 1, now });
  const storagePath = path.join(rootDir, "storage");
  const userDataDir = path.join(storagePath, "settings");
  mkdirSync(storagePath, { recursive: true });
  renameSync(base.userDataDir, userDataDir);
  const userDir = path.join(userDataDir, "User");
  const globalChat = path.join(userDir, "globalStorage", "github.copilot-chat");
  const sessionStoreDbPath = path.join(globalChat, "session-store.db");
  // The integration base's lone "Fix the bug" session (redacted text) is replaced by the demo sessions.
  rmFixtureBaseSession(userDir, sessionStoreDbPath);

  const repositories = {
    demo: { ...REPOSITORIES.demo, path: path.join(rootDir, "repos", REPOSITORIES.demo.folder) },
    ledger: { ...REPOSITORIES.ledger, path: path.join(rootDir, "repos", REPOSITORIES.ledger.folder) },
  };
  createGitFolder(repositories.demo.path, repositories.demo.remote);
  createGitFolder(repositories.ledger.path, repositories.ledger.remote);

  const debugLogsDirs = {
    demo: path.join(userDir, "workspaceStorage", WORKSPACE_STORAGE_IDS.demo, "GitHub.copilot-chat", "debug-logs"),
    ledger: path.join(userDir, "workspaceStorage", WORKSPACE_STORAGE_IDS.ledger, "GitHub.copilot-chat", "debug-logs"),
  };
  for (const key of ["demo", "ledger"] as const) {
    mkdirSync(debugLogsDirs[key], { recursive: true });
    // VS Code deletes workspace storage that names no existing folder.
    writeFileSync(path.join(userDir, "workspaceStorage", WORKSPACE_STORAGE_IDS[key], "workspace.json"), JSON.stringify({ folder: pathToFileURL(repositories[key].path).href }));
  }
  const copilotHome = path.join(rootDir, "copilot-home");
  mkdirSync(copilotHome, { recursive: true });
  createAgentHostCatalog(userDataDir);

  // Each session: its start, and the AI Credits it adds to the month so far if it started on or after `periodStartKey`.
  const { resetDay, daysAgo: periodStartDaysAgo } = periodStart(now);
  const periodStartKey = localDayKey(new Date(now.getTime() - periodStartDaysAgo * DAY_MS));
  let monthToDate = 0;
  let listed = 0;
  const record = (startedAt: Date, credits: number): void => {
    listed++;
    if (localDayKey(startedAt) >= periodStartKey) monthToDate += credits;
  };
  const classic = (repo: keyof typeof REPOSITORIES, session: DemoClassicSession): void => {
    record(session.startedAt, writeClassicSession({ sessionStoreDbPath, debugLogsDir: debugLogsDirs[repo] }, session));
  };
  const agent = (session: DemoAgentSession): void => {
    writeAgentSession(userDataDir, copilotHome, session);
    record(session.startedAt, agentSessionCredits(session));
  };

  let index = 1;
  const readSession: DemoClassicSession = {
    id: classicId(index++),
    title: "Add pagination to the orders API",
    startedAt: startOf(now, 0, 0, 75),
    cwd: repositories.demo.path,
    turns: readSessionTurns(),
    toolInventory: TOOL_INVENTORY,
    systemPrompt: DEMO_SYSTEM_PROMPT,
  };
  classic("demo", readSession);
  const idleSession: DemoClassicSession = { id: classicId(index++), title: "Fix the flaky checkout test", startedAt: startOf(now, 1, 3, 0), cwd: repositories.demo.path, turns: idleSessionTurns(), toolInventory: TOOL_INVENTORY };
  classic("demo", idleSession);
  const todaySmall = (repo: keyof typeof REPOSITORIES, title: string, minutesAgo: number): DemoClassicSession => ({
    id: classicId(index++),
    title,
    startedAt: startOf(now, 0, 0, minutesAgo),
    cwd: repositories[repo].path,
    turns: fillerTurns(mulberry32(index * 101), title).slice(0, 3),
  });
  classic("demo", todaySmall("demo", "Fix the failing lint step", 12));
  classic("ledger", todaySmall("ledger", "Explain the settlement job", 30));
  FILLERS.forEach((spec, fillerIndex) => {
    const id = classicId(index++);
    const session: DemoClassicSession = {
      id,
      title: spec.title,
      startedAt: startOf(now, spec.daysAgo, fillerIndex, 0),
      cwd: repositories[spec.repo].path,
      turns: fillerTurns(mulberry32(index * 7919), spec.title),
      ...(spec.withTools ? { toolInventory: TOOL_INVENTORY } : {}),
    };
    classic(spec.repo, session);
  });

  const auditSession: DemoAgentSession = {
    id: agentId(1),
    sdkId: sdkId(1),
    title: "Move the build scripts to pnpm",
    startedAt: startOf(now, 0, 0, 20),
    cwd: repositories.demo.path,
    turns: auditSessionTurns(),
  };
  agent(auditSession);
  agent({ id: agentId(2), sdkId: sdkId(2), title: "Bump the Dockerfile base image", startedAt: startOf(now, 6, 4, 0), cwd: repositories.ledger.path, turns: dockerTurns });

  const monthToDateCredits = round2(monthToDate);
  const userSettings: Record<string, string | number | boolean | object> = {
    ...(variant === "ready" ? USER_SETTINGS : Object.fromEntries(Object.entries(USER_SETTINGS).filter(([key]) => !SETUP_PROBLEM_REMOVED(key)))),
    // A billing period that holds every session of the last three weeks, wherever in the month the run is.
    "aiCreditsAnalyzer.monthlyAllowance.resetDay": resetDay,
  };
  writeFileSync(path.join(userDir, "settings.json"), `${JSON.stringify(userSettings, null, 2)}\n`);

  return {
    variant,
    storagePath,
    userDataDir,
    userSettings,
    copilotHome,
    workspacePath: repositories.demo.path,
    repositories,
    readSession: { id: readSession.id, title: readSession.title, turns: readSession.turns.length, subagentTurns: READ_SUBAGENT_TURNS },
    systemPromptMarker: DEMO_SYSTEM_PROMPT_MARKER,
    replayModel: REPLAY_MODEL,
    savings: { kinds: ["unused-tools", "failed-tool-calls", "idle-cache-expiry", "model-switch"], unusedToolsServers: MCP_SERVERS, failedPrograms: ["rg", "curl"] },
    auditSession: { id: auditSession.id, title: auditSession.title, categories: AUDIT_CATEGORIES, unknownCalls: 1 },
    // Just above the warning threshold, so the status bar and the Sessions row say "near the limit".
    allowanceForNearLimit: Math.floor(monthToDateCredits / TARGET_USED_FRACTION),
    monthToDateCredits,
    resetDay,
    periodStartDaysAgo,
    listedSessionCount: listed,
  };
}

import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";

// createIntegrationFixture seeds the usage session's debug log under `integration-workspace` and its store row.
function rmFixtureBaseSession(userDir: string, sessionStoreDbPath: string): void {
  rmSync(path.join(userDir, "workspaceStorage", "integration-workspace"), { recursive: true, force: true });
  const db = new DatabaseSync(sessionStoreDbPath);
  try {
    db.exec("DELETE FROM turns; DELETE FROM sessions;");
  } finally {
    db.close();
  }
}

// Kept for the types the scenes import.
export type { DemoClassicSession, DemoClassicTurn, DemoAgentSession };
export { classicSessionCredits };
