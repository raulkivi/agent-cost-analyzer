// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExtensionApiService } from "@agent-cost-analyzer/server/src/composition/create-extension-api-service";
import { InMemoryAppSettingsStore } from "@agent-cost-analyzer/server/src/test-support/in-memory-app-settings-store";
import { copilotLogPathsFromUserDataDir } from "../../src/platform/copilot-log-paths.js";
import { createRepositorySources } from "../../src/sidebar/repository-sources.js";
import { SidebarController } from "../../src/sidebar/sidebar-controller.js";
import { createDemoFixture, DEMO_SYSTEM_PROMPT_MARKER, demoVariantOfSpec, parseDemoFixture, type DemoFixture } from "./demo-fixture.mts";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server");
const DAY_MS = 86_400_000;
const LOGGING = "github.copilot.chat.agentDebugLog.fileLogging.enabled";

// Scenes E1, E3-E8 and E10 run on this fixture (docs/plans/docs-refresh-and-demo-recordings.md
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

  it("E3: the read-a-session session has 8 or more turns, subagent runs and a system prompt", async () => {
    const api = apiOver(fixture);
    const session = await api.getSession(fixture.readSession.id);
    expect(session.title).toBe(fixture.readSession.title);
    expect(session.turns.length).toBeGreaterThanOrEqual(8);
    const withRuns = session.turns.flatMap((turn, index) => ((turn.usage.subagents?.length ?? 0) > 0 ? [index] : []));
    expect(withRuns).toEqual(fixture.readSession.subagentTurns);
    expect(await api.getSystemPromptText(fixture.readSession.id)).toContain(DEMO_SYSTEM_PROMPT_MARKER);
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
