// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Manual checks 1.5, 1.6 and 1.11 (docs/plans/vscode-extension-manual-checks.md),
// driven in a real VS Code (step 10.16). Each test title cites its check.
import { Key } from "webdriverio";
import { browser, expect } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import { evaluateBudgets, formatBudgetReport } from "../../../src/performance/performance-budgets.js";
import type { TimingMark } from "../../../src/performance/performance-recorder.js";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { parseUiFixture, UI_FIXTURE_ENV } from "../support/ui-fixture-env.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const fixture = parseUiFixture(process.env[UI_FIXTURE_ENV]);
const panel = new AnalyzerPanel(host);
// Generous for a CI machine under xvfb; the actual time is logged.
const SELECT_TURN_BOUND_MS = 500;

suite("Panel (checks 1.5, 1.6, 1.11)", () => {
  setup(async () => {
    await host.waitForExtension();
    await panel.reset();
  });

  test("1.5 a 150-turn session renders every row within the section 3.5 budgets, and selecting a turn answers quickly", async () => {
    await panel.openSession(fixture.largeSessionId);

    await panel.inside(async (view) => {
      await view.waitForTurnRows(fixture.largeSessionTurns);
      // The header row is a thead row: 151 rows with it.
      const headerRows = await browser.execute(() => document.querySelectorAll("table thead tr").length);
      expect((await view.turnRowCount()) + headerRows).toBe(fixture.largeSessionTurns + 1);

      const { scrollWidth, clientWidth } = await view.horizontalOverflow();
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

      await view.selectTurn(0);
      const started = Date.now();
      await view.selectTurn(120);
      await view.waitForText("Turn 120");
      const elapsed = Date.now() - started;
      console.log(`1.5 selecting turn 120 took ${elapsed} ms (bound ${SELECT_TURN_BOUND_MS} ms)`);
      expect(elapsed).toBeLessThan(SELECT_TURN_BOUND_MS);
    });

    const marks = await host.hook<TimingMark[]>(INTERNAL_COMMAND_IDS.perfMarks);
    const report = evaluateBudgets(marks, { "first-render": 1000, "data-ready": 1000 });
    console.log(`1.5 budgets:\n${formatBudgetReport(report)}`);
    expect(report.ok).toBe(true);
  });

  test("1.6 cancelling a slow dashboard load shows 'Loading cancelled', and Retry loads it", async () => {
    await host.hook(INTERNAL_COMMAND_IDS.holdRequests, ["getInsights"]);
    try {
      await panel.openSession(fixture.usageSessionId);
      await panel.inside(async (view) => {
        await view.waitForTurnRows(1);
        await view.chooseOption("Dashboard");
        const skeleton = await browser.$('[data-testid="async-skeleton"]');
        await skeleton.waitForDisplayed({ timeout: 30_000 });
        await view.clickButton("Cancel");
        await view.waitForText("Loading cancelled");
      });
    } finally {
      await host.hook(INTERNAL_COMMAND_IDS.releaseRequests);
    }

    await panel.inside(async (view) => {
      await view.clickButton("Retry");
      await browser.waitUntil(async () => !(await view.hasText("Loading cancelled")), { timeout: 30_000 });
      await view.waitForText("Insights");
    });
  });

  test("1.11 the system prompt opens read-only in an editor, and copying works", async () => {
    await panel.openSession(fixture.usageSessionId);
    await panel.inside(async (view) => {
      await view.waitForTurnRows(1);
      // Choose the tab again until its content shows: a click in the first
      // moments after the page loads can land before React is listening.
      await browser.waitUntil(
        async () => {
          await view.showTab("System prompt");
          await browser.pause(500);
          return view.hasText("System prompt breakdown");
        },
        { timeout: 30_000, interval: 500, timeoutMsg: "the System prompt tab did not open" },
      );
      await view.clickButton("Open system prompt inspector");
      await view.clickButton("Open prompt in editor");
    });

    await browser.waitUntil(async () => (await host.activeEditor()).scheme === "ai-credits-analyzer-doc", {
      timeout: 30_000,
      timeoutMsg: "the system prompt did not open in a read-only editor",
    });
    const editor = await host.activeEditor();
    expect(editor.text).toContain(fixture.systemPromptMarker);

    await host.command("workbench.action.focusActiveEditorGroup");
    await browser.keys(["x"]);
    const after = await host.activeEditor();
    expect(after.isDirty).toBe(false);
    expect(after.text).toBe(editor.text);

    // Select everything through the API (a select-all key needs the right focus), then copy with the key.
    await browser.executeWorkbench((vscode) => {
      const active = vscode.window.activeTextEditor;
      if (!active) throw new Error("no active editor");
      const last = active.document.lineAt(active.document.lineCount - 1);
      active.selection = new vscode.Selection(0, 0, last.lineNumber, last.text.length);
    });
    await host.command("workbench.action.focusActiveEditorGroup");
    await browser.keys([Key.Ctrl, "c"]);
    await browser.waitUntil(async () => (await host.clipboardText()).includes(fixture.systemPromptMarker), {
      timeout: 10_000,
      timeoutMsg: "the copied prompt is not on the clipboard",
    });
  });
});
