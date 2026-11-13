// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensionApiService } from "@agent-cost-analyzer/server/src/composition/create-extension-api-service";
import { InMemoryAppSettingsStore } from "@agent-cost-analyzer/server/src/test-support/in-memory-app-settings-store";
import { copilotLogPathsFromUserDataDir } from "../../src/platform/copilot-log-paths.js";
import { createUiFixture, DANGLING_SESSION, SUBAGENT_SESSION } from "./ui-fixture.mts";

// Step 10.19 (SA15): the UI fixture's two classic sessions, one with a
// runSubagent and a searchSubagent run, one with a dangling child-session ref,
// read back as the Sessions view (list) and the panel (detail) read them.
describe("the UI fixture's classic subagent sessions (step 10.19)", () => {
  let rootDir: string;

  afterEach(() => rmSync(rootDir, { recursive: true, force: true }));

  function apiOver(now: Date) {
    rootDir = mkdtempSync(path.join(tmpdir(), "aica-subagents-"));
    const fixture = createUiFixture(rootDir, { sessionCount: 3, now });
    const here = path.dirname(fileURLToPath(import.meta.url));
    return createExtensionApiService({
      ...copilotLogPathsFromUserDataDir(fixture.userDataDir),
      copilotHome: null,
      appSettings: new InMemoryAppSettingsStore(),
      learnScriptsDir: path.resolve(here, "../../../server/fixtures/learn-scripts"),
      vendorProfilesDir: path.resolve(here, "../../../server/fixtures/vendor-profiles"),
      appVersion: "0.0.0-test",
    });
  }

  it("dates the sessions relative to the fixture's now, so they start today whenever it runs", async () => {
    const now = new Date("2026-11-13T12:00:00.000Z");
    const api = apiOver(now);

    const listed = await api.listSessions();

    for (const { id } of [SUBAGENT_SESSION, DANGLING_SESSION]) {
      const started = Date.parse(listed.find((session) => session.id === id)!.startedAt!);
      expect(now.getTime() - started).toBeGreaterThan(0);
      expect(now.getTime() - started).toBeLessThan(60_000);
    }
  });

  it("agrees in list and detail for the session with runs, whose total folds both runs in", async () => {
    const api = apiOver(new Date());

    const listed = (await api.listSessions()).find((session) => session.id === SUBAGENT_SESSION.id)!;
    const detail = await api.getSession(SUBAGENT_SESSION.id);

    expect(listed.title).toBe(SUBAGENT_SESSION.title);
    expect(listed.costAiCredits).toEqual(detail.costAiCredits);
    expect(listed.subagentSpend).toEqual(detail.subagentSpend);
    expect(detail.costAiCredits).toEqual({ known: true, value: SUBAGENT_SESSION.expectedCredits });
    expect(detail.subagentSpend?.runs).toBe(2);
    const names = detail.turns.flatMap((turn) => turn.usage.subagents ?? []).map((run) => run.agentName ?? run.label);
    expect(names).toEqual(expect.arrayContaining(["Explore", "searchSubagent"]));
  });

  it("agrees in list and detail for the session with a dangling ref, whose AI Credits are unknown with the reason", async () => {
    const api = apiOver(new Date());

    const listed = (await api.listSessions()).find((session) => session.id === DANGLING_SESSION.id)!;
    const detail = await api.getSession(DANGLING_SESSION.id);

    expect(listed.costAiCredits).toEqual(detail.costAiCredits);
    expect(detail.costAiCredits.known).toBe(false);
    expect(listed.subagentSpend?.costAiCredits.known).toBe(false);
  });
});
