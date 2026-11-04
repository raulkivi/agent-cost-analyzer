import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExtensionApiService } from "@agent-cost-analyzer/server/src/composition/create-extension-api-service";
import { InMemoryAppSettingsStore } from "@agent-cost-analyzer/server/src/test-support/in-memory-app-settings-store";
import { copilotLogPathsFromUserDataDir } from "../../src/platform/copilot-log-paths.js";
import { LARGE_SESSION_TURNS, createUiFixture } from "./ui-fixture.mts";

const learnScenariosFixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/fixtures/learn-scenarios");

// The fixture the VS Code UI automation (wdio.conf.mts, step 10.16) seeds,
// read back by the extension's own Copilot-only ApiService in plain Node.
describe("createUiFixture (step 10.16)", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "aica-ui-fixture-"));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  function apiOver(userDataDir: string, copilotHome: string | null = null) {
    return createExtensionApiService({
      ...copilotLogPathsFromUserDataDir(userDataDir),
      copilotHome,
      appSettings: new InMemoryAppSettingsStore(),
      learnScenariosFixturesDir,
      appVersion: "0.0.0-test",
    });
  }

  it("lays the user data out where wdio-vscode-service reads it: <storagePath>/settings", () => {
    const fixture = createUiFixture(rootDir, { sessionCount: 3 });

    expect(fixture.storagePath).toBe(path.join(rootDir, "storage"));
    expect(fixture.userDataDir).toBe(path.join(fixture.storagePath, "settings"));
    expect(existsSync(path.join(fixture.userDataDir, "User", "globalStorage", "github.copilot-chat", "session-store.db"))).toBe(true);
  });

  it("hands the user settings to the service as a capability, matching what the file would hold", () => {
    const fixture = createUiFixture(rootDir, { sessionCount: 1 });

    expect(fixture.userSettings).toMatchObject({ "aiCreditsAnalyzer.mcp.enabled": false });
    expect(JSON.parse(readFileSync(path.join(fixture.userDataDir, "User", "settings.json"), "utf-8"))).toEqual(fixture.userSettings);
  });

  it("seeds a long session whose turns read back through the extension's ApiService", async () => {
    const fixture = createUiFixture(rootDir, { sessionCount: 3 });

    expect(LARGE_SESSION_TURNS).toBe(150);
    expect(fixture.largeSessionTurns).toBe(LARGE_SESSION_TURNS);
    const session = await apiOver(fixture.userDataDir).getSession(fixture.largeSessionId);
    expect(session.turns).toHaveLength(150);
  });

  it("gives the usage session a system prompt for the System prompt tab", async () => {
    const fixture = createUiFixture(rootDir, { sessionCount: 3 });

    const text = await apiOver(fixture.userDataDir).getSystemPromptText(fixture.usageSessionId);
    expect(text).toContain(fixture.systemPromptMarker);
  });

  it("reports the session count the Sessions view must show (the isolation guard)", async () => {
    const fixture = createUiFixture(rootDir, { sessionCount: 5 });

    const sessions = await apiOver(fixture.userDataDir, fixture.copilotHome).listSessions();
    expect(sessions.length).toBe(fixture.listedSessionCount);
  });

  it("points the Copilot CLI home at a directory of event logs", () => {
    const fixture = createUiFixture(rootDir, { sessionCount: 1 });

    expect(existsSync(fixture.copilotHome)).toBe(true);
  });
});
