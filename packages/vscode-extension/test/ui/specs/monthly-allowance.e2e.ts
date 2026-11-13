// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Step 10.21 (monthly AI Credits allowance gauge), task MA9, plan §7: the
// status bar item, the Sessions view's first row and the settings, driven in
// a real VS Code. The fixture's sessions all start within 72 hours of the run
// (ui-fixture.mts, `now`), and the reset day is derived from the run date, so
// they fall in the period whenever the suite runs.
import { browser, expect } from "@wdio/globals";
import { COPILOT_CLI_FIXTURE_SESSION_IDS } from "../../../../server/src/test-support/copilot-cli-fixtures.ts";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import { ALLOWANCE_SETTING, gaugeDom, gaugeLabel, isOpaque, parseColor, RESET_DAY_SETTING, resetDayFor, statusBarItems, usedFrom } from "../support/monthly-allowance-gauge.js";
import { saveScreenshot } from "../support/screenshots.js";
import { SidebarViews } from "../support/sidebar-views.js";
import { parseUiFixture, UI_FIXTURE_ENV } from "../support/ui-fixture-env.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const fixture = parseUiFixture(process.env[UI_FIXTURE_ENV]);
const sidebar = new SidebarViews();
const THEME_SETTING = "workbench.colorTheme";
const FIND_MODE_SETTING = "workbench.list.defaultFindMode";
const WARN_AT_PERCENT = 80;
// The usage session, the empty-window session, the classic session with subagent runs (step 10.19) and the Copilot CLI sessions of the fixture.
const KNOWN_SESSIONS = 3 + Object.keys(COPILOT_CLI_FIXTURE_SESSION_IDS).length;
const MONTH_ROW = /^This month: /;

interface TreeNode {
  kind: string;
  id?: string;
  label?: string;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

async function setAllowance(value: number | undefined): Promise<void> {
  await host.setSetting(ALLOWANCE_SETTING, value);
}

async function waitForGauge(present: boolean, timeoutMsg: string, matches: (label: string) => boolean = () => true): Promise<string | undefined> {
  let label: string | undefined;
  try {
    await browser.waitUntil(
      async () => {
        label = await gaugeLabel();
        return present ? label !== undefined && matches(label) : label === undefined;
      },
      { timeout: 30_000, interval: 500 },
    );
  } catch {
    throw new Error(`${timeoutMsg} (the status bar had: ${JSON.stringify(await statusBarItems())})`);
  }
  return label;
}

// The allowance (in AI Credits) at which the fixture's known cost reads `percent` of it.
let knownUsed = 0;
const allowanceAt = (percent: number): number => round2((knownUsed * 100) / percent);

async function showLevel(percent: number): Promise<string> {
  const allowance = allowanceAt(percent);
  await setAllowance(allowance);
  const label = await waitForGauge(true, `the gauge did not show ${allowance}`, (text) => text.includes(`of ${allowance.toLocaleString("en-US", { maximumFractionDigits: 2 })} allowance`));
  return label!;
}

async function sessionsTree(): Promise<TreeNode[]> {
  return host.hook<TreeNode[]>(INTERNAL_COMMAND_IDS.sessionsTree);
}

async function notificationMessages(): Promise<string[]> {
  const workbench = await browser.getWorkbench();
  return Promise.all((await workbench.getNotifications()).map((notification) => notification.getMessage()));
}

suite("Monthly allowance gauge (step 10.21, MA9)", () => {
  suiteSetup(async () => {
    await host.waitForExtension({ userDataDir: fixture.userDataDir });
    // Copilot Chat is built in but disabled in a new profile; until it is
    // enabled the "setup needed" item takes over the status bar (check 1.4).
    await host.command("workbench.extensions.action.enableAll");
    await browser.waitUntil(async () => (await statusBarItems()).some((item) => item.startsWith("AI Credits today")), {
      timeout: 90_000,
      timeoutMsg: "the status bar did not switch from 'setup needed' to today's AI Credits once Copilot Chat was enabled",
    });
    await host.setSetting(RESET_DAY_SETTING, resetDayFor(new Date()));
    // A huge allowance: the normal level, so the known cost can be read off the label.
    await setAllowance(1_000_000);
    // Sessions load in turn: wait until the usage session and every Copilot CLI fixture session are counted.
    const label = await waitForGauge(true, "the gauge did not count the fixture sessions", (text) => Number(/(\d+) of \d+ sessions? this month/.exec(text)?.[1]) === KNOWN_SESSIONS);
    knownUsed = usedFrom(label!);
  });

  suiteTeardown(async () => {
    await setAllowance(undefined);
    await host.setSetting(RESET_DAY_SETTING, undefined);
    await host.setSetting(THEME_SETTING, undefined);
    await host.setSetting(FIND_MODE_SETTING, undefined);
  });

  test("the gauge shows in the status bar with an accessibility label for the month-to-date, allowance, percentage, days left and coverage", async () => {
    const label = await showLevel(50);

    expect(label).toMatch(
      /^AI Credits this month: (at least )?[\d,.]+ of [\d,.]+ allowance, \d+ percent, \d+ days? left, \d+ of \d+ sessions? this month (has|have) cost data\. Open Sessions\.$/,
    );
    expect((await gaugeDom())?.text).toMatch(/^(at least )?[\d,.]+ of [\d,.]+ AI Credits$/);
  });

  test("Agent Host, Copilot CLI and empty-window sessions are counted in the month total", async () => {
    // Known cost: the Copilot Chat usage session, the empty-window session (a
    // global debug log, no folder) and every Copilot CLI fixture session (Agent Host store).
    const label = await showLevel(50);
    const coverage = /(\d+) of (\d+) sessions? this month/.exec(label)!;

    expect(Number(coverage[1])).toBe(KNOWN_SESSIONS);
    expect(Number(coverage[2])).toBeGreaterThan(KNOWN_SESSIONS);
    // Two usage-log sessions (9.65 each) and the Agent Host sessions on top.
    expect(knownUsed).toBeGreaterThan(2 * 9.64);
    const todayItem = (await statusBarItems()).find((item) => item.startsWith("AI Credits today"))!;
    expect(todayItem).toContain(`AI Credits today: ${knownUsed.toFixed(2)}`);
  });

  test("an unknown cost is never 0: the total reads 'at least', not a plain figure, and never '0 of'", async () => {
    const label = await showLevel(50);
    const dom = await gaugeDom();

    // Seeded sessions have no usage data, so the total is a lower bound.
    expect(label).toContain("at least");
    expect(dom?.text.startsWith("at least ")).toBe(true);
    expect(label).not.toMatch(/(?:^|[^\d.,])0(?:\.00)? of /);
    expect(dom?.text).not.toMatch(/^(at least )?0(\.00)? of /);
  });

  test("the Sessions view's first row reads 'This month: ...' and the allowance row is the first node of the tree", async () => {
    await showLevel(50);
    const tree = await sessionsTree();

    expect(tree[0]).toMatchObject({ kind: "message", id: "monthly-allowance" });
    expect(tree[0]!.label).toMatch(MONTH_ROW);
    await sidebar.showAlone("sessions");
    await browser.waitUntil(async () => MONTH_ROW.test((await sidebar.rowTexts("sessions"))[0] ?? ""), { timeout: 30_000, timeoutMsg: "the Sessions view's first row is not the allowance row" });
    const [first] = await sidebar.rowTexts("sessions");
    expect(first).toMatch(/^This month: (at least )?[\d,.]+ of [\d,.]+ AI Credits/);
    expect(first).toMatch(/· \d+ days? left$/);
  });

  test("the level is in words, not colour alone: 'near limit' and 'over' in the text, the label, the row and the item's state class", async () => {
    const near = await showLevel(90);
    const nearDom = await gaugeDom();
    expect(near).toMatch(/^Near limit\. AI Credits this month/);
    expect(nearDom?.text).toMatch(/ · near limit$/);
    expect(nearDom?.classes).toContain("warning-kind");
    expect(nearDom?.classes).not.toContain("error-kind");
    const [nearRow] = await sidebar.rowTexts("sessions");
    expect(nearRow).toContain(" · near limit");

    const over = await showLevel(200);
    const overDom = await gaugeDom();
    expect(over).toMatch(/^Over the allowance\. AI Credits this month/);
    expect(overDom?.text).toMatch(/ · over$/);
    expect(overDom?.classes).toContain("error-kind");
    expect(overDom?.classes).not.toContain("warning-kind");
    const [overRow] = await sidebar.rowTexts("sessions");
    expect(overRow).toContain(" · over");

    const normal = await showLevel(50);
    expect(normal).toMatch(/^AI Credits this month/);
    expect(WARN_AT_PERCENT).toBeLessThan(90);
    expect((await gaugeDom())?.classes.some((name) => name === "warning-kind" || name === "error-kind")).toBe(false);
  });

  // Measured in a live window (MA5): the status bar's own warning and error
  // backgrounds. Dark High Contrast draws no fill (words and a border carry the level).
  const FILLS = [
    { theme: "Default Dark Modern", warning: { r: 122, g: 100, b: 0 }, error: { r: 185, g: 16, b: 7 } },
    { theme: "Default Light Modern", warning: { r: 114, g: 81, b: 2 }, error: { r: 199, g: 46, b: 15 } },
    { theme: "Default High Contrast Light", warning: { r: 137, g: 85, b: 3 }, error: { r: 181, g: 32, b: 13 } },
    { theme: "Default High Contrast", warning: undefined, error: undefined },
  ] as const;
  for (const { theme, warning, error } of FILLS) {
    test(`${theme}: the warning and error states have the measured background${warning ? "" : " (none: no fill)"}`, async () => {
      await host.setSetting(THEME_SETTING, theme);
      for (const [state, expected, percent] of [["warning", warning, 90], ["error", error, 200]] as const) {
        await showLevel(percent);
        let seen = "";
        try {
          await browser.waitUntil(
            async () => {
              const dom = await gaugeDom();
              seen = `${dom?.background} ${dom?.classes.join(" ")}`;
              if (dom === undefined || !dom.classes.includes(`${state}-kind`)) return false;
              const color = parseColor(dom.background);
              return expected ? isOpaque(color, expected) : color !== undefined && color.a === 0;
            },
            { timeout: 20_000, interval: 500 },
          );
        } catch {
          throw new Error(`${theme} ${state}: expected ${expected ? JSON.stringify(expected) : "no fill"}, the item had ${seen}`);
        }
        await saveScreenshot(`monthly-allowance-${theme.replace(/\s+/g, "-").toLowerCase()}-${state}`);
      }
    });
  }

  test("the Settings editor shows the three settings with their descriptions, under User", async () => {
    await host.setSetting(THEME_SETTING, undefined);
    const expectations = [
      { id: ALLOWANCE_SETTING, description: "Leave empty or 0 to turn the monthly gauge off" },
      { id: RESET_DAY_SETTING, description: "Day of the month (1 to 28) your billing period starts" },
      { id: "aiCreditsAnalyzer.monthlyAllowance.warnAtPercent", description: "at which the gauge warns that you are near the limit" },
    ];
    for (const { id, description } of expectations) {
      void host.command("workbench.action.openSettings", `@id:${id}`).catch(() => undefined);
      await browser.waitUntil(
        () =>
          browser.execute(
            (settingId: string, text: string) => {
              const editor = document.querySelector<HTMLElement>(".settings-editor");
              const query = Array.from(editor?.querySelectorAll<HTMLElement>(".suggest-input-container") ?? []).map((element) => element.innerText).join(" ");
              const rows = Array.from(editor?.querySelectorAll<HTMLElement>(".settings-tree-container .monaco-list-row") ?? []);
              return query.includes(`@id:${settingId}`) && rows.length === 1 && rows[0]!.innerText.includes(text);
            },
            id,
            description,
          ),
        { timeout: 30_000, interval: 500, timeoutMsg: `the Settings editor does not show ${id} with its description` },
      );
      const tabs = await browser.execute(() => Array.from(document.querySelectorAll<HTMLElement>(".settings-editor .settings-tabs-widget .action-label")).map((element) => element.innerText.trim()));
      // User is the tab the editor opens on; the Workspace tab with a folder open is checked in monthly-allowance-trust.e2e.ts.
      expect(tabs.some((tab) => tab.startsWith("User"))).toBe(true);
    }
    await host.command("workbench.action.closeAllEditors");
  });

  test("VS Code's own filter hides the row with every session, and the row is back once the filter is cleared; the gauge stays in the status bar", async () => {
    await showLevel(50);
    await host.setSetting(FIND_MODE_SETTING, "filter");
    await sidebar.showAlone("sessions");
    // The find widget takes the keys only once the tree has focus: retry until it holds the text.
    const filterText = (): Promise<string> => browser.execute(() => document.querySelector<HTMLInputElement>(".monaco-tree-type-filter input")?.value ?? "");
    await browser.waitUntil(
      async () => {
        await host.command("aiCreditsAnalyzer.sessions.focus");
        await host.command("list.find");
        await browser.keys(["z", "z", "z", "z"]);
        await browser.takeScreenshot();
        return (await filterText()).includes("zzzz");
      },
      { timeout: 30_000, interval: 1000, timeoutMsg: "the Sessions view's filter did not take the text" },
    );
    // The tree's own filter hides every row that does not match, a message row too:
    // an extension cannot pin a row against it, so the gauge in the status bar is what stays.
    await browser.waitUntil(async () => !(await sidebar.rowTexts("sessions")).some((row) => MONTH_ROW.test(row)), { timeout: 20_000, timeoutMsg: "the filter did not hide the row" });
    expect(await gaugeLabel()).toBeDefined();

    await browser.keys(["Escape"]);
    await host.setSetting(FIND_MODE_SETTING, undefined);
    await browser.waitUntil(async () => MONTH_ROW.test((await sidebar.rowTexts("sessions"))[0] ?? ""), { timeout: 20_000, timeoutMsg: "the row did not come back with the filter cleared" });
  });

  test("not set: neither the status bar item nor the Sessions row exists", async () => {
    await setAllowance(undefined);
    await waitForGauge(false, "the gauge is still in the status bar");

    expect(await gaugeDom()).toBeUndefined();
    expect((await sessionsTree()).some((node) => node.kind === "message" && node.id === "monthly-allowance")).toBe(false);
    await browser.waitUntil(async () => !(await sidebar.rowTexts("sessions")).some((row) => MONTH_ROW.test(row)), { timeout: 30_000, timeoutMsg: "the Sessions view still has the row" });
  });

  test("no notification mentions AI Credits", async () => {
    await showLevel(200);
    await showLevel(90);

    expect((await notificationMessages()).filter((message) => /AI Credits/i.test(message))).toEqual([]);
  });
});
