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
import { createRepositorySources } from "../../src/sidebar/repository-sources.js";
import { SidebarController } from "../../src/sidebar/sidebar-controller.js";
import { createS9Fixture, S9_EXPECTED } from "./s9-fixture.mts";

// Scenario S9's expected figures (step 15.14) hold over its fixture: the
// extension's own sidebar code, wired as composition.ts wires it, gives the
// group totals and the status bar the wdio spec then reads off the screen.
const serverFixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server/fixtures");

describe("scenario S9's fixture", () => {
  let rootDir: string;
  afterEach(() => rmSync(rootDir, { recursive: true, force: true }));

  async function sidebarOverFixture() {
    const now = new Date();
    const fixture = createS9Fixture(rootDir, now);
    const api = createExtensionApiService({
      ...copilotLogPathsFromUserDataDir(fixture.userDataDir),
      copilotHome: fixture.copilotHome,
      appSettings: new InMemoryAppSettingsStore(),
      learnScriptsDir: path.join(serverFixtures, "learn-scripts"),
      vendorProfilesDir: path.join(serverFixtures, "vendor-profiles"),
      appVersion: "0.0.0-test",
    });
    const sidebar = new SidebarController(
      {
        listSessions: () => api.listSessions(),
        listLearnScenarios: async () => [],
        getConfigStatus: () => api.getConfigStatus(),
        relistLogSources: () => {},
        // VS Code opens portal-web.
        ...createRepositorySources(() => [fixture.workspacePath]),
      },
      { now: () => now, grouping: { read: () => "repository", write: () => {} } },
    );
    await sidebar.refresh();
    return { sidebar, fixture };
  }

  it("groups the sessions into its two repositories with the expected totals", async () => {
    rootDir = mkdtempSync(path.join(tmpdir(), "aica-s9-"));
    const { sidebar } = await sidebarOverFixture();

    expect(sidebar.sessionsTree().map((node) => node.kind === "group" && { label: node.label, description: node.description })).toEqual(S9_EXPECTED.groups);
  });

  it("names the workspace's repository in the status bar, with every repository's total", async () => {
    rootDir = mkdtempSync(path.join(tmpdir(), "aica-s9-"));
    const { sidebar } = await sidebarOverFixture();

    expect(sidebar.statusBar()?.text).toBe(`$(graph) ${S9_EXPECTED.statusText}`);
    expect(sidebar.statusBar()?.ariaLabel).toBe(S9_EXPECTED.statusAriaLabel);
  });
});
