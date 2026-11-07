// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Manual checks 1.1, 1.3 and the Copilot-Chat-missing half of 1.2
// (docs/plans/vscode-extension-manual-checks.md), in a VS Code that has never
// seen the extension or Copilot Chat (step 10.16, wdio.conf.mts "first-run"
// launch). Copilot Chat is not enabled here (it ships built in, off in a new
// profile), so the analyzer reports it unavailable, as the manual 1.1/1.3 runs
// did. Nothing here uses a real Copilot account or chat.
import { readFileSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { SidebarViews, VIEW_CONTAINER_TITLE } from "../support/sidebar-views.js";
import { FIRST_RUN_FIXTURE_ENV, parseFirstRunFixture } from "../support/ui-fixture-env.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const fixture = parseFirstRunFixture(process.env[FIRST_RUN_FIXTURE_ENV]);
const sidebar = new SidebarViews();
const settingsFile = path.join(fixture.userDataDir, "User", "settings.json");
let initialSettings = "";

const SETUP_NEEDED = "AI Credits Analyzer needs setup. Open setup.";
const COPILOT_UNAVAILABLE = "GitHub Copilot Chat is disabled or not installed";

async function editorTitles(): Promise<string[]> {
  return (await browser.getWorkbench()).getEditorView().getOpenEditorTitles();
}

suite("First run in a VS Code that has never seen Copilot Chat (checks 1.1, 1.2, 1.3)", () => {
  suiteSetup(async () => {
    await host.waitForExtension({ keepStartupEditors: true });
    // The file as the service wrote it at start-up (defaults plus the fixture settings).
    initialSettings = readFileSync(settingsFile, "utf-8");
    expect(JSON.parse(initialSettings)).toMatchObject(fixture.userSettings);
  });

  test("1.1 the Get Started walkthrough opens once as an editor tab, not a notification, and the icon and 'setup needed' show", async () => {
    await browser.waitUntil(async () => (await editorTitles()).length > 0, { timeout: 60_000, timeoutMsg: "the walkthrough did not open" });
    expect(await editorTitles()).toEqual(["Welcome"]);
    const walkthrough = await browser.execute(() => (document.querySelector(".gettingStartedContainer") as HTMLElement | null)?.innerText ?? "");
    expect(walkthrough).toContain("Get started with AI Credits Analyzer");

    const workbench = await browser.getWorkbench();
    // The walkthrough is an editor tab, not a notification: no notification about it or the analyzer
    // (VS Code may show unrelated ones, e.g. on a slow machine).
    const messages = await Promise.all((await workbench.getNotifications()).map((notification) => notification.getMessage()));
    expect(messages.filter((message) => /walkthrough|get started|AI Credits/i.test(message))).toEqual([]);
    expect(await workbench.getActivityBar().getViewControl(VIEW_CONTAINER_TITLE)).toBeDefined();
    const statusItems = await workbench.getStatusBar().getItems();
    expect(statusItems).toContain(SETUP_NEEDED);
  });

  test("1.3 the Sessions view says why it is empty and points to Learn mode; the Learn view lists the 17 scenarios", async () => {
    const [welcome] = await sidebar.rowTexts("sessions");
    expect(welcome).toContain("No Copilot Chat sessions with token data yet");
    expect(welcome).toContain("Open Learn mode");

    // A small window on purpose: zoomed in, the Learn tree shows only a few
    // of its rows at a time (as on a short CI screen), so the check must walk
    // the tree rather than count what fits.
    for (let step = 0; step < 4; step++) await host.command("workbench.action.zoomIn");
    await sidebar.showAlone("learn");
    // Loaded: at least one scenario row is drawn (a frame is forced while waiting).
    await browser.waitUntil(
      async () => {
        await browser.takeScreenshot();
        return (await sidebar.rowTexts("learn")).some((row) => /\d+ turns? ·/.test(row));
      },
      { timeout: 60_000, interval: 1000, timeoutMsg: "the Learn view did not list any scenario" },
    );
    const scenarios = (await sidebar.allRowTexts("learn")).filter((row) => /\d+ turns? ·/.test(row));
    for (let step = 0; step < 4; step++) await host.command("workbench.action.zoomOut");
    expect(scenarios).toHaveLength(17);
    // 17 different scenarios, not one row seen twice.
    expect(new Set(scenarios.map((row) => row.replace(/\d+ turns? ·.*$/, ""))).size).toBe(17);
  });

  test("1.3 and 1.2 Setup lists the missing Copilot Chat and the logging settings as warnings, and changes nothing by itself", async () => {
    await sidebar.showAlone("setup");
    const rows = await sidebar.rowTexts("setup");
    expect(rows.some((row) => row.includes(COPILOT_UNAVAILABLE))).toBe(true);
    expect(rows.some((row) => row.includes("debug logging is disabled"))).toBe(true);
    // Viewing Setup (and the first run) left the user's settings as seeded.
    expect(readFileSync(settingsFile, "utf-8")).toBe(initialSettings);
  });

  test("1.2 Fix on the missing Copilot Chat opens the Extensions view on it, and still changes no setting", async () => {
    await sidebar.clickRowAction("setup", COPILOT_UNAVAILABLE, "Fix Setting");
    await browser.waitUntil(
      async () => (await browser.execute(() => Array.from(document.querySelectorAll<HTMLElement>(".extensions-viewlet .view-lines, .extensions-viewlet .monaco-editor")).map((e) => e.innerText).join(" "))).includes("@id:GitHub.copilot-chat"),
      { timeout: 15_000, timeoutMsg: "the Extensions view was not searched for GitHub Copilot Chat" },
    );
    expect(readFileSync(settingsFile, "utf-8")).toBe(initialSettings);
  });
});

// Not automated: 1.1's "it didn't reopen after a second reload". A reload ends
// the wdio session (its proxy lives in the extension host), and under the
// driver VS Code keeps global state in memory (its log says "Creating shared
// storage database at ':memory:'", no state.vscdb is written within 30 s of a
// quit), so a second launch cannot tell "offered once" from "state lost".
// WalkthroughOffer's unit tests cover the logic; the owner checks the reload.
