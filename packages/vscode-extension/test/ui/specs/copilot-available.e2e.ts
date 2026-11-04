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

    const status = (await statusItems()).find((item) => item.includes("AI Credits today"))!;
    const coverage = /AI Credits today: ([\d.]+), (\d+) of (\d+) sessions? today have cost data/.exec(status);
    expect(coverage).not.toBeNull();
    const [, total, known] = coverage!;
    expect(Number(known)).toBeGreaterThanOrEqual(1);
    // Only the usage session has cost data among today's sessions (the others have no turns' usage).
    if (known === "1") expect(total).toBe(credits);

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
