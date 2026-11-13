// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Manual checks 1.4 (normal use) and the Copilot-Chat-present half of 1.2
// (logging off), in a VS Code where Copilot Chat is installed and enabled
// (step 10.16, wdio.conf.mts "copilot" launch).
//
// What this is NOT: a real Copilot chat. Copilot Chat ships built in to VS
// Code but is off in a fresh profile; the spec enables it, without signing in.
// The sessions come from the seeded fixture (Copilot Chat's own store layout),
// not from a chat, so a real chat producing a session stays the owner's
// opt-in suite (test:ui:vscode:copilot) or a manual run.
import { readFileSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import type { GroupNode, SessionsTreeNode } from "../../../src/sidebar/sessions-tree-model.js";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { SidebarViews } from "../support/sidebar-views.js";
import { COPILOT_FIXTURE_ENV, parseUiFixture } from "../support/ui-fixture-env.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const fixture = parseUiFixture(process.env[COPILOT_FIXTURE_ENV], COPILOT_FIXTURE_ENV);
const sidebar = new SidebarViews();
const panel = new AnalyzerPanel(host);
const settingsFile = path.join(fixture.userDataDir, "User", "settings.json");
const LOGGING_SETTING = "github.copilot.chat.agentDebugLog.fileLogging.enabled";

function statusItems(): Promise<string[]> {
  return browser.getWorkbench().then((workbench) => workbench.getStatusBar().getItems());
}

const TODAY_STATUS = /AI Credits today: ([\d.]+), (\d+) of (\d+) sessions? today (?:has|have) cost data/;

// Today's sessions as the extension's own Sessions tree holds them: how many,
// and the AI Credits of each one with cost data (an unknown one shows words).
async function todaysSessions(): Promise<{ count: number; credits: number[] }> {
  const tree = await host.hook<SessionsTreeNode[]>(INTERNAL_COMMAND_IDS.sessionsTree);
  const today = tree.find((node): node is GroupNode => node.kind === "group" && node.label === "Today");
  const descriptions = today?.children.map((session) => session.description) ?? [];
  return { count: descriptions.length, credits: descriptions.filter((text) => /^\d+\.\d\d$/.test(text)).map(Number) };
}

suite("Copilot Chat installed, fixture sessions (checks 1.4, 1.2)", () => {
  suiteSetup(async () => {
    await host.waitForExtension({ userDataDir: fixture.userDataDir });
    // Copilot Chat is built in but disabled globally in a new profile.
    await host.command("workbench.extensions.action.enableAll");
    await browser.waitUntil(async () => (await statusItems()).some((item) => item.includes("AI Credits today")), {
      timeout: 90_000,
      timeoutMsg: "the status bar did not switch from 'setup needed' to today's AI Credits once Copilot Chat was enabled",
    });
    await panel.reset();
  });

  test("1.4 (fixture session) a session shows under Today with its AI Credits, picking it opens the panel, and the status bar shows today's known AI Credits with coverage", async () => {
    await sidebar.showAlone("sessions");
    const rows = await sidebar.allRowTexts("sessions");
    const usageRow = rows.find((row) => row.startsWith(fixture.usageSessionTitle));
    expect(usageRow).toMatch(/^Fix the bug[1-9]\d*\.\d\d$|^Fix the bug0\.\d*[1-9]$/);
    const credits = usageRow!.slice(fixture.usageSessionTitle.length);
    // A session without cost data says so, never a 0.
    expect(rows.filter((row) => row.includes("AI Credits unknown")).length).toBeGreaterThan(0);

    // The status bar counts exactly today's sessions with cost data, the ones
    // the Sessions tree lists under Today: the usage session and, since step
    // 10.21 MA9, the empty-window and Copilot CLI fixture sessions too.
    let status = "";
    let today = { count: 0, credits: [] as number[] };
    try {
      await browser.waitUntil(
        async () => {
          status = (await statusItems()).find((item) => item.includes("AI Credits today")) ?? "";
          today = await todaysSessions();
          const coverage = TODAY_STATUS.exec(status);
          return coverage !== null && Number(coverage[2]) === today.credits.length && Number(coverage[3]) === today.count;
        },
        { timeout: 30_000, interval: 500 },
      );
    } catch {
      throw new Error(`the status bar's coverage does not match today's sessions: "${status}", Today has ${JSON.stringify(today)}`);
    }
    const [, total, known] = TODAY_STATUS.exec(status)!;
    expect(Number(known)).toBeGreaterThanOrEqual(1);
    expect(today.credits).toContain(Number(credits));
    // The sum of the known sessions' AI Credits; each row is rounded to cents.
    const rowsSum = today.credits.reduce((sum, value) => sum + value, 0);
    expect(Math.abs(Number(total) - rowsSum)).toBeLessThanOrEqual(0.005 * today.credits.length + 1e-9);
    // Step 10.19: the classic session with subagent runs is one of today's
    // sessions with cost data; its folded figure is in this sum like the others.

    await sidebar.select("sessions", fixture.usageSessionTitle);
    await browser.waitUntil(async () => (await (await browser.getWorkbench()).getAllWebviews()).length > 0, { timeout: 30_000 });
    await panel.inside(async (view) => {
      await view.waitForText(fixture.usageSessionTitle);
      await view.waitForTurnRows(1);
    });
  });

  test("1.2 with logging off, Setup lists it with a Fix button that opens exactly that setting and changes nothing by itself", async () => {
    await host.setSetting(LOGGING_SETTING, false);
    await sidebar.showAlone("setup");
    await browser.waitUntil(async () => (await sidebar.rowTexts("setup")).some((row) => row.includes("debug logging is disabled")), {
      timeout: 30_000,
      timeoutMsg: "Setup did not list the disabled logging setting",
    });
    const before = readFileSync(settingsFile, "utf-8");

    await sidebar.clickRowAction("setup", "debug logging is disabled", "Fix Setting");
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => Array.from(document.querySelectorAll<HTMLElement>(".settings-editor .suggest-input-container")).map((e) => e.innerText).join(" "))).includes(`@id:${LOGGING_SETTING}`),
      { timeout: 30_000, timeoutMsg: "the Settings editor was not opened on the logging setting" },
    );
    expect(readFileSync(settingsFile, "utf-8")).toBe(before);
    expect(await host.setting(LOGGING_SETTING)).toBe(false);
  });
});
