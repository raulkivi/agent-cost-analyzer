// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_TOOLS_SHOWN } from "@agent-cost-analyzer/web/lib/savings/savings-view";
import { isFailedStatus, unlistedTools } from "@agent-cost-analyzer/domain";
import { createExtensionApiService } from "@agent-cost-analyzer/server/src/composition/create-extension-api-service";
import { InMemoryAppSettingsStore } from "@agent-cost-analyzer/server/src/test-support/in-memory-app-settings-store";
import { copilotLogPathsFromUserDataDir } from "../../src/platform/copilot-log-paths.js";
import { createRepositorySources } from "../../src/sidebar/repository-sources.js";
import { SidebarController } from "../../src/sidebar/sidebar-controller.js";
import { createDemoFixture, DEMO_SYSTEM_PROMPT_MARKER, demoVariantOfSpec, parseDemoFixture, type DemoFixture } from "./demo-fixture.mts";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server");
const DAY_MS = 86_400_000;
const LOGGING = "github.copilot.chat.agentDebugLog.fileLogging.enabled";

// Scenes E1, E3-E8 and E10 run on this fixture (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/docs-refresh-and-demo-recordings.md
// task 1.6a): every claim below is read back through the extension's own ApiService.
describe("createDemoFixture", () => {
  let rootDir: string;
  let fixture: DemoFixture;
  const now = new Date();

  const apiOver = (f: DemoFixture) =>
    createExtensionApiService({
      ...copilotLogPathsFromUserDataDir(f.userDataDir),
      copilotHome: f.copilotHome,
      appSettings: new InMemoryAppSettingsStore(),
      learnScriptsDir: path.join(SERVER, "fixtures/learn-scripts"),
      vendorProfilesDir: path.join(SERVER, "fixtures/vendor-profiles"),
      appVersion: "0.0.0-test",
    });

  beforeAll(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "aica-demo-fx-"));
    fixture = createDemoFixture(rootDir, { now });
  });
  afterAll(() => rmSync(rootDir, { recursive: true, force: true }));

  it("lays the user data out where wdio-vscode-service reads it, with the workspace folder a git repository", () => {
    expect(fixture.userDataDir).toBe(path.join(fixture.storagePath, "settings"));
    expect(existsSync(path.join(fixture.userDataDir, "User", "globalStorage", "github.copilot-chat", "session-store.db"))).toBe(true);
    expect(fixture.workspacePath).toBe(fixture.repositories.demo.path);
    const origin = execFileSync("git", ["-C", fixture.workspacePath, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    expect(origin).toBe("https://github.com/aica-e2e/demo.git");
  });

  it("has made-up sessions in two repositories over at least four weeks", async () => {
    const api = apiOver(fixture);
    const sidebar = new SidebarController(
      { listSessions: () => api.listSessions(), listLearnScenarios: async () => [], getConfigStatus: () => api.getConfigStatus(), relistLogSources: () => {}, ...createRepositorySources(() => [fixture.workspacePath]) },
      { now: () => now, grouping: { read: () => "repository", write: () => {} } },
    );
    await sidebar.refresh();
    const groups = sidebar.sessionsTree().flatMap((node) => (node.kind === "group" ? [node.label] : []));
    expect(groups).toEqual(expect.arrayContaining(["github.com/aica-e2e/demo", "github.com/aica-e2e/ledger-service"]));
    // The workspace folder is one of them, so the status bar names it.
    expect(sidebar.statusBar()?.text).toContain("demo");
    const sessions = await api.listSessions();
    const earliest = Math.min(...sessions.map((session) => Date.parse(session.startedAt ?? "")));
    expect(now.getTime() - earliest).toBeGreaterThanOrEqual(28 * DAY_MS);
    expect(sessions.every((session) => session.costAiCredits.known)).toBe(true);
    expect(sessions).toHaveLength(fixture.listedSessionCount);
  });

  // CI runs at any hour: just after midnight, sessions placed minutes before the run used to land
  // on yesterday, leaving no "today" (no status-bar total).
  it("keeps today's sessions on today when the run starts just after midnight", async () => {
    const early = new Date(now);
    early.setHours(0, 7, 0, 0);
    const root = mkdtempSync(path.join(tmpdir(), "aica-demo-fx-early-"));
    try {
      const f = createDemoFixture(root, { now: early });
      const sessions = await apiOver(f).listSessions();
      const midnight = new Date(early);
      midnight.setHours(0, 0, 0, 0);
      const today = sessions.filter((session) => Date.parse(session.startedAt ?? "") >= midnight.getTime());
      expect(today.length).toBeGreaterThanOrEqual(4);
      expect(today.every((session) => Date.parse(session.startedAt ?? "") <= early.getTime())).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("E3: the read-a-session session has 8 or more turns, subagent runs and a system prompt", async () => {
    const api = apiOver(fixture);
    const session = await api.getSession(fixture.readSession.id);
    expect(session.title).toBe(fixture.readSession.title);
    expect(session.turns.length).toBeGreaterThanOrEqual(8);
    const withRuns = session.turns.flatMap((turn, index) => ((turn.usage.subagents?.length ?? 0) > 0 ? [index] : []));
    expect(withRuns).toEqual(fixture.readSession.subagentTurns);
    expect(await api.getSystemPromptText(fixture.readSession.id)).toContain(DEMO_SYSTEM_PROMPT_MARKER);
  });

  // Step 10.24 (DR10): E8 and E3 read the subagent runs' tool calls in the same session.
  it("E8, E3: the read-a-session session's runs hold child-log tool calls, one failed, and one run is unread with its reason", async () => {
    const api = apiOver(fixture);
    const audit = await api.getSessionAudit(fixture.readSession.id);
    const expected = fixture.readSession.subagentAudit;
    expect(audit.byOrigin?.subagents).toMatchObject({ toolCalls: expected.calls, failed: expected.failed, runs: expected.runs });
    expect(expected.failed).toBeGreaterThanOrEqual(1);
    const unread = (audit.subagentRuns ?? []).filter((run) => run.totals === null);
    expect(unread).toHaveLength(expected.unread);
    expect(unread[0]?.unreadReason).toMatch(/writes no log/);
    // The unread run adds no AI Credits to the session: E3 and E4 read the same figure.
    expect((await api.getSession(fixture.readSession.id)).costAiCredits.known).toBe(true);
  });

  it("E3: the first subagent turn shows calls from its run, one of them failed", async () => {
    const api = apiOver(fixture);
    const detail = await api.getSession(fixture.readSession.id);
    const turn = detail.turns[fixture.readSession.subagentTurns[0]!]!;
    const calls = turn.toolCalls.filter((call) => call.origin?.kind === "subagent");
    expect(calls).toHaveLength(fixture.readSession.firstRun.calls);
    expect(calls.filter((call) => call.outcome !== undefined && isFailedStatus(call.outcome.status))).toHaveLength(fixture.readSession.firstRun.failed);
  });

  it("E4: the session replays on another model, its self-check passing and a coverage line that names the subagent runs", async () => {
    const api = apiOver(fixture);
    const replay = await api.getSessionReplay(fixture.readSession.id, { model: fixture.replayModel });
    expect(replay.turns.length).toBeGreaterThanOrEqual(8);
    expect(replay.selfCheck).toBeDefined();
    expect(replay.coverage.subagentRuns?.runs).toBeGreaterThan(0);
    expect(replay.selfCheck?.passed).toBe(true);
  });

  it("E5: Savings finds at least three opportunities over the default 30 days, and leaves something not analysed", async () => {
    const api = apiOver(fixture);
    const report = await api.getSavingsReport({ since: new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10), pricing: "as-of-use", includeSimulated: false });
    const kinds = report.opportunities.map((opportunity) => opportunity.kind);
    expect(kinds.length).toBeGreaterThanOrEqual(3);
    expect(kinds).toEqual(expect.arrayContaining(fixture.savings.kinds));
    expect(report.notAnalysed.length).toBeGreaterThan(0);
  });

  // V25: the browser looks a title up in the insights dataset by `${providerId}:${sessionId}`. An Agent Host
  // session whose title only echoes its first prompt is untitled by design ("Session <id>"), so no demo
  // session may do that: every session of every Savings row needs a real title there.
  it("E5: every session of every Savings row has a real title in the insights dataset", async () => {
    const api = apiOver(fixture);
    const since = new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10);
    const report = await api.getSavingsReport({ since, pricing: "as-of-use", includeSimulated: false });
    const { sessions } = await api.getInsights({ since: report.window.since, until: report.window.until, limit: "200" });
    const titles = new Map(sessions.map((row) => [row.key, row.title]));
    const refs = report.opportunities.flatMap((opportunity) => opportunity.sessions);
    expect(refs.length).toBeGreaterThan(0);
    const untitled = refs.filter((ref) => (titles.get(`${ref.providerId}:${ref.sessionId}`) ?? `Session ${ref.sessionId}`) === `Session ${ref.sessionId}`);
    expect(untitled.map((ref) => ref.sessionId)).toEqual([]);
  });

  // R23: "and N more (about X)" shows only when every listed tool was loaded in every session of the row.
  it("E5: the unused-tools row names an MCP server with at least six tools, each loaded in every session of the row, inside the 30 days", async () => {
    const api = apiOver(fixture);
    const since = new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10);
    const report = await api.getSavingsReport({ since, pricing: "as-of-use", includeSimulated: false });
    const row = report.opportunities.find((opportunity) => opportunity.kind === "unused-tools" && opportunity.subject === fixture.savings.unusedToolsRow.server);
    expect(row).toBeDefined();
    expect(row!.toolsTotal).toBe(fixture.savings.unusedToolsRow.tools);
    expect(row!.toolsTotal!).toBeGreaterThanOrEqual(6);
    for (const tool of row!.tools!) expect(tool.sessions).toBe(row!.evidence.sessions);
    const rest = unlistedTools(row!.tools!.slice(0, MAX_TOOLS_SHOWN), row!.toolsTotal!, row!.evidence.tokens, row!.evidence.sessions);
    expect(rest.count).toBeGreaterThan(0);
    expect(rest.tokens).not.toBeNull();
    const listed = await api.listSessions();
    const titles = new Map(listed.map((session) => [session.id, session.title]));
    expect(row!.sessions.length).toBeGreaterThanOrEqual(3);
    for (const ref of row!.sessions) {
      expect(titles.get(ref.sessionId)).toBeTruthy();
      expect(Date.parse(ref.startedAt ?? "")).toBeGreaterThanOrEqual(now.getTime() - 30 * DAY_MS);
    }
  });

  it("E8: the tool-audit session has failed calls in several categories and an Unknown outcome", async () => {
    const api = apiOver(fixture);
    const audit = await api.getSessionAudit(fixture.auditSession.id);
    const categories = new Set(audit.calls.map((entry) => entry.call.outcome?.failureCategory).filter((category) => category !== undefined));
    expect(categories.size).toBeGreaterThanOrEqual(4);
    expect(audit.calls.some((entry) => entry.call.outcome?.status === "unknown")).toBe(true);
    for (const category of fixture.auditSession.categories) expect([...categories]).toContain(category);
  });

  it("E7: the month so far is about 82 % of allowanceForNearLimit, and the period starts on the fixture's reset day", async () => {
    const api = apiOver(fixture);
    const periodStart = new Date(now.getTime() - fixture.periodStartDaysAgo * DAY_MS);
    expect(periodStart.getDate()).toBe(fixture.resetDay);
    expect(fixture.userSettings["aiCreditsAnalyzer.monthlyAllowance.resetDay"]).toBe(fixture.resetDay);
    const startKey = periodStart.toLocaleDateString("en-CA");
    const used = (await api.listSessions())
      .filter((session) => session.startedAt !== undefined && new Date(session.startedAt).toLocaleDateString("en-CA") >= startKey)
      .reduce((sum, session) => sum + (session.costAiCredits.known ? session.costAiCredits.value : 0), 0);
    expect(used).toBeCloseTo(fixture.monthToDateCredits, 1);
    expect(used / fixture.allowanceForNearLimit).toBeGreaterThanOrEqual(0.8);
    expect(used / fixture.allowanceForNearLimit).toBeLessThan(0.86);
    // The scene types it; the fixture itself leaves the allowance unset.
    expect(fixture.userSettings["aiCreditsAnalyzer.monthlyAllowance.aiCredits"]).toBeUndefined();
  });

  it("the ready variant sets Copilot's debug logging, retention and traces, so Setup has nothing to flag", () => {
    expect(fixture.variant).toBe("ready");
    expect(fixture.userSettings[LOGGING]).toBe(true);
    expect(fixture.userSettings["github.copilot.chat.otel.dbSpanExporter.enabled"]).toBe(true);
    expect(fixture.userSettings["github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs"]).toBeGreaterThanOrEqual(200);
  });

  it("the setup-problem variant (E1) has the same data but no Copilot logging setting, and the MCP server off", async () => {
    const problemRoot = mkdtempSync(path.join(tmpdir(), "aica-demo-fx-"));
    try {
      const problem = createDemoFixture(problemRoot, { now, variant: "setup-problem" });
      expect(problem.variant).toBe("setup-problem");
      expect(problem.userSettings[LOGGING]).toBeUndefined();
      expect(problem.userSettings["aiCreditsAnalyzer.mcp.enabled"]).toBe(false);
      expect((await apiOver(problem).listSessions()).length).toBe(problem.listedSessionCount);
    } finally {
      rmSync(problemRoot, { recursive: true, force: true });
    }
  });

  it("holds nothing from the owner's machine: its text names only the made-up repositories", async () => {
    const api = apiOver(fixture);
    const sessions = await api.listSessions();
    const home = process.env.HOME ?? "/home";
    expect(JSON.stringify(sessions)).not.toContain(home);
  });
});

describe("demoVariantOfSpec", () => {
  it("runs a scene named e1-*.demo.ts on the setup-problem launch and every other scene on the ready one", () => {
    expect(demoVariantOfSpec("e1-get-started.demo.ts")).toBe("setup-problem");
    expect(demoVariantOfSpec("/abs/test/ui/demo/e1-get-started.demo.ts")).toBe("setup-problem");
    expect(demoVariantOfSpec("e10-learn.demo.ts")).toBe("ready");
    expect(demoVariantOfSpec("e0-smoke.demo.ts")).toBe("ready");
    expect(demoVariantOfSpec("e3-read-session.demo.ts")).toBe("ready");
  });
});

describe("parseDemoFixture", () => {
  it("reads the fixture a worker gets in the environment, and says what is wrong with a missing one", () => {
    expect(() => parseDemoFixture(undefined, "AICA_DEMO_FIXTURE")).toThrow(/AICA_DEMO_FIXTURE is not set/);
    expect(() => parseDemoFixture("{}", "AICA_DEMO_FIXTURE")).toThrow(/storagePath/);
    const rootDir = mkdtempSync(path.join(tmpdir(), "aica-demo-fx-"));
    try {
      const made = createDemoFixture(rootDir);
      expect(parseDemoFixture(JSON.stringify(made), "AICA_DEMO_FIXTURE").readSession.id).toBe(made.readSession.id);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
