import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensionApiService } from "@agent-cost-analyzer/server/src/composition/create-extension-api-service";
import { InMemoryAppSettingsStore } from "@agent-cost-analyzer/server/src/test-support/in-memory-app-settings-store";
import { copilotLogPathsFromUserDataDir } from "../../src/platform/copilot-log-paths.js";
import { createUiFixture } from "./ui-fixture.mts";

// Found by step 10.16's work on checks 2.3/2.4: on the seeded usage session
// the Sessions list said 9.64735 AI Credits, while the session's detail (what
// the panel's turns and get_session_cost read) said 7.33953, because the
// detail dropped the debug log's second turn, which the session store has no
// row for. 2.3 expects "the same AI Credits the panel shows".
describe("a session's AI Credits in the list and in its detail", () => {
  let rootDir: string;

  afterEach(() => rmSync(rootDir, { recursive: true, force: true }));

  it("agree for the seeded usage session", async () => {
    rootDir = mkdtempSync(path.join(tmpdir(), "aica-credits-"));
    const fixture = createUiFixture(rootDir, { sessionCount: 3 });
    const api = createExtensionApiService({
      ...copilotLogPathsFromUserDataDir(fixture.userDataDir),
      copilotHome: null,
      appSettings: new InMemoryAppSettingsStore(),
      learnScenariosFixturesDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/fixtures/learn-scenarios"),
      learnScriptsDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/fixtures/learn-scripts"),
      vendorProfilesDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/fixtures/vendor-profiles"),
      appVersion: "0.0.0-test",
    });

    const listed = (await api.listSessions()).find((session) => session.id === fixture.usageSessionId);
    const detail = await api.getSession(fixture.usageSessionId);

    expect(listed?.costAiCredits).toEqual(detail.costAiCredits);
    // Every billed request in the session's debug log (copilotUsageNanoAiu summed by hand).
    expect(detail.costAiCredits.known && detail.costAiCredits.value).toBeCloseTo(9.64735, 9);
  });
});
