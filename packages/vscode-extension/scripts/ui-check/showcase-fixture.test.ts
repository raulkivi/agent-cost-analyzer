import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExtensionApiService } from "@agent-cost-analyzer/server/src/composition/create-extension-api-service";
import { InMemoryAppSettingsStore } from "@agent-cost-analyzer/server/src/test-support/in-memory-app-settings-store";
import { copilotLogPathsFromUserDataDir } from "../../src/platform/copilot-log-paths.js";
import { AGENT_HOST_SESSION_ID, AGENT_HOST_SESSION_TITLE, createShowcaseFixture } from "./showcase-fixture.mts";

const learnScenariosFixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/fixtures/learn-scenarios");
const NOW = new Date("2026-10-24T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

// The made-up Copilot Chat data the Marketplace screenshots show (step
// 10.10), read back by the same Copilot-only ApiService the extension builds.
describe("createShowcaseFixture", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "aica-showcase-test-"));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  function apiOver(userDataDir: string) {
    return createExtensionApiService({
      ...copilotLogPathsFromUserDataDir(userDataDir),
      copilotHome: null,
      appSettings: new InMemoryAppSettingsStore(),
      learnScenariosFixturesDir,
      appVersion: "0.0.0-test",
    });
  }

  it("seeds sessions across the last two weeks, every one with known AI Credits", async () => {
    const fixture = createShowcaseFixture(rootDir, { now: NOW });

    const sessions = await apiOver(fixture.userDataDir).listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(20);
    expect(sessions.every((session) => session.costAiCredits?.known)).toBe(true);
    const days = new Set(sessions.map((session) => session.startedAt!.slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(10);
    for (const session of sessions) {
      expect(NOW.getTime() - Date.parse(session.startedAt!)).toBeLessThan(14 * DAY_MS);
    }
  });

  it("uses several models", async () => {
    const fixture = createShowcaseFixture(rootDir, { now: NOW });

    const api = apiOver(fixture.userDataDir);
    const models = new Set<string>();
    for (const { id } of await api.listSessions()) {
      for (const turn of (await api.getSession(id)).turns) {
        if (turn.usage.model) models.add(turn.usage.model);
      }
    }
    expect(models.size).toBeGreaterThanOrEqual(3);
  });

  it("gives the featured session several turns with tool calls, cache reads and cache writes", async () => {
    const fixture = createShowcaseFixture(rootDir, { now: NOW });

    const session = await apiOver(fixture.userDataDir).getSession(fixture.featuredSessionId);
    expect(session.title).toBe(fixture.featuredSessionTitle);
    expect(Date.parse(session.startedAt!)).toBe(NOW.getTime());
    expect(session.turns.length).toBeGreaterThanOrEqual(6);
    expect(session.turns.every((turn) => turn.usage.costAiCredits.known)).toBe(true);
    expect(session.turns.every((turn) => turn.usage.cacheWrite.known && turn.usage.reasoning.known)).toBe(true);
    expect(session.turns.filter((turn) => turn.toolCalls.length > 0).length).toBeGreaterThanOrEqual(4);
    expect(session.turns.slice(1).every((turn) => turn.usage.cacheRead.known && turn.usage.cacheRead.value > 0)).toBe(true);
  });

  it("seeds no Agent Host session unless asked, so the Marketplace pictures stay as they are", async () => {
    const fixture = createShowcaseFixture(rootDir, { now: NOW });

    const sessions = await apiOver(fixture.userDataDir).listSessions();
    expect(sessions.some((session) => session.copilotHarness === "agent-host")).toBe(false);
  });

  it("seeds one Agent Host session with a few turns of known usage when asked", async () => {
    const fixture = createShowcaseFixture(rootDir, { now: NOW, includeAgentHostSession: true });

    const api = apiOver(fixture.userDataDir);
    const agentHost = (await api.listSessions()).filter((session) => session.copilotHarness === "agent-host");
    expect(agentHost.map((session) => session.id)).toEqual([AGENT_HOST_SESSION_ID]);
    const session = await api.getSession(AGENT_HOST_SESSION_ID);
    expect(session.title).toBe(AGENT_HOST_SESSION_TITLE);
    expect(session.turns.length).toBeGreaterThanOrEqual(3);
    expect(session.turns.every((turn) => turn.usage.costAiCredits.known)).toBe(true);
    expect(NOW.getTime() - Date.parse(session.startedAt!)).toBeLessThan(DAY_MS);
  });

  it("is the same data every time for the same moment", async () => {
    const first = createShowcaseFixture(path.join(rootDir, "a"), { now: NOW });
    const second = createShowcaseFixture(path.join(rootDir, "b"), { now: NOW });

    const credits = async (userDataDir: string) =>
      (await apiOver(userDataDir).listSessions()).map((session) => [session.id, session.costAiCredits]);
    expect(await credits(first.userDataDir)).toEqual(await credits(second.userDataDir));
  });

  it("names its workspace storage folder as VS Code does for a folder, so VS Code doesn't delete it at start-up", () => {
    const fixture = createShowcaseFixture(rootDir, { now: NOW });

    const workspaceStorage = path.join(fixture.userDataDir, "User", "workspaceStorage");
    const folders = readdirSync(workspaceStorage);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(readFileSync(path.join(workspaceStorage, folders[0], "workspace.json"), "utf-8"))).toHaveProperty("folder");
  });

  it("writes settings that leave nothing for setup to report", async () => {
    const fixture = createShowcaseFixture(rootDir, { now: NOW });

    expect((await apiOver(fixture.userDataDir).getConfigStatus()).warnings).toEqual([]);
  });
});
