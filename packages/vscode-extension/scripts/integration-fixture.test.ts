import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExtensionApiService } from "@copilot-cost-analyzer/server/src/composition/create-extension-api-service";
import { InMemoryAppSettingsStore } from "@copilot-cost-analyzer/server/src/test-support/in-memory-app-settings-store";
import { copilotLogPathsFromUserDataDir } from "../src/platform/copilot-log-paths.js";
import { parseIntegrationFixture } from "./integration-fixture-env.mts";
import { createIntegrationFixture } from "./integration-fixture.mts";

const learnScenariosFixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/fixtures/learn-scenarios");
const NOW = new Date("2026-10-24T12:00:00Z");

// The fixture the real-VS Code integration suite (.vscode-test.mjs) seeds,
// read here by the same Copilot-only ApiService the extension builds, in
// plain Node: the suite itself can't run in every environment.
describe("createIntegrationFixture (step 10.9)", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "aica-fixture-test-"));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  function apiOver(userDataDir: string) {
    return createExtensionApiService({
      ...copilotLogPathsFromUserDataDir(userDataDir),
      appSettings: new InMemoryAppSettingsStore(),
      learnScenariosFixturesDir,
      appVersion: "0.0.0-test",
    });
  }

  it("seeds a VS Code user-data dir whose session store holds 200 Copilot Chat sessions by default", async () => {
    const fixture = createIntegrationFixture(rootDir, { now: NOW });

    expect(fixture.userDataDir).toBe(path.join(rootDir, "user-data"));
    expect(fixture.sessionCount).toBe(200);
    const sessions = await apiOver(fixture.userDataDir).listSessions();
    expect(sessions).toHaveLength(200);
    expect(new Set(sessions.map((session) => session.id)).size).toBe(200);
  });

  it("gives the usage session a debug log with real AI Credits numbers, and every session a start time", async () => {
    const fixture = createIntegrationFixture(rootDir, { sessionCount: 3, now: NOW });

    const sessions = await apiOver(fixture.userDataDir).listSessions();
    const usage = sessions.find((session) => session.id === fixture.usageSessionId);
    expect(usage).toMatchObject({ title: fixture.usageSessionTitle, costAiCredits: { known: true } });
    expect(sessions.every((session) => typeof session.startedAt === "string")).toBe(true);
    expect(sessions.map((session) => session.title).sort()).toEqual([fixture.usageSessionTitle, "Seeded session 1", "Seeded session 2"].sort());
  });

  it("starts the usage session now, so it's in the Sessions view's Today group, and the others earlier", async () => {
    const fixture = createIntegrationFixture(rootDir, { sessionCount: 3, now: NOW });

    const sessions = await apiOver(fixture.userDataDir).listSessions();
    const startOf = (id: string) => Date.parse(sessions.find((session) => session.id === id)!.startedAt!);
    expect(startOf(fixture.usageSessionId)).toBe(NOW.getTime());
    for (const session of sessions.filter((entry) => entry.id !== fixture.usageSessionId)) {
      expect(Date.parse(session.startedAt!)).toBeLessThan(NOW.getTime());
    }
  });

  it("writes user settings with Copilot debug logging on and the MCP server off, so setup reports nothing", async () => {
    const fixture = createIntegrationFixture(rootDir, { sessionCount: 1, now: NOW });

    const settings = JSON.parse(readFileSync(path.join(fixture.userDataDir, "User", "settings.json"), "utf-8")) as Record<string, unknown>;
    expect(settings).toMatchObject({
      "github.copilot.chat.agentDebugLog.fileLogging.enabled": true,
      "aiCreditsAnalyzer.mcp.enabled": false,
    });
    expect((await apiOver(fixture.userDataDir).getConfigStatus()).warnings).toEqual([]);
  });

  it("refuses a session count below 1", () => {
    expect(() => createIntegrationFixture(rootDir, { sessionCount: 0 })).toThrow(/at least 1/);
  });

  it("describes itself in the form the suite reads back from the environment", () => {
    const fixture = createIntegrationFixture(rootDir, { sessionCount: 1, now: NOW });

    expect(parseIntegrationFixture(JSON.stringify(fixture))).toEqual(fixture);
  });
});
