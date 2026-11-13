// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Scenario SV1 in the extension (Phase 16 SR15, docs/plans/savings-report.md
// §10 SR15, boards VsCodeDark, VsCodeLight, VsCodeHC, VsCodeNarrow), driven in
// a real VS Code: the panel's Savings view after Dashboard. The fixture's
// Copilot sessions (SR13) hold an unused MCP server (`acmedocs`, a local
// session priced in AI Credits from estimated tokens) and repeated failed
// `rg` calls (an Agent Host session). Every figure is compared with the
// ApiService's own answer at run time (support/savings-api.ts, the panel's
// getSavingsReport RPC), the Copilot-only scope and the pointer to the
// standalone app are shown, Copy reaches the clipboard, the view is readable
// in Dark Modern, Light Modern and High Contrast (S9's probe and judge), and
// below 600 px the detail replaces the list.
import { browser, expect } from "@wdio/globals";
import type { SavingsOpportunity, SavingsReport } from "@agent-cost-analyzer/domain";
import { judgeProbe, type Probe } from "../../../scripts/ui-check/judge.mts";
import { PROBE_SCRIPT } from "../../../scripts/ui-check/probe.mts";
import { expectedListName, expectedRow } from "../../../../web/e2e/support/savings-text.js";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { isWithinTolerance, nextGroupFraction } from "../support/panel-width.js";
import { savingsReportOver } from "../support/savings-api.js";
import { clickDetailButton, focusDetailButton, focusedRowIndex, hasProviderFilter, openRow, readDetail, readSavings, waitForSavings } from "../support/savings-view.js";
import { saveScreenshot } from "../support/screenshots.js";
import { parseUiFixture, UI_FIXTURE_ENV } from "../support/ui-fixture-env.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const fixture = parseUiFixture(process.env[UI_FIXTURE_ENV]);
const panel = new AnalyzerPanel(host);
const THEME_SETTING = "workbench.colorTheme";
const WAIT_MS = 30_000;

let report: SavingsReport;

function opportunityOf(kind: SavingsOpportunity["kind"]): { opportunity: SavingsOpportunity; index: number } {
  const index = report.opportunities.findIndex((candidate) => candidate.kind === kind);
  if (index < 0) throw new Error(`the report has no ${kind} opportunity`);
  return { opportunity: report.opportunities[index]!, index };
}

async function openSavings(): Promise<void> {
  await panel.reset();
  await panel.openDashboard();
  await panel.inside(async (view) => {
    await view.chooseOption("Analyze");
    // The option appears once the host's product profile has loaded.
    await browser.waitUntil(
      async () => {
        try {
          await view.chooseOption("Savings");
          return true;
        } catch {
          return false;
        }
      },
      { timeout: WAIT_MS, interval: 500, timeoutMsg: "the panel offers no Savings view" },
    );
    await waitForSavings();
  });
}

suite("Scenario SV1: VS Code, the Savings view (Phase 16 SR15)", () => {
  suiteSetup(async () => {
    await host.waitForExtension({ userDataDir: fixture.userDataDir });
    report = await savingsReportOver(fixture);
  });

  suiteTeardown(async () => {
    await host.setSetting(THEME_SETTING, undefined);
    await host.command("vscode.setEditorLayout", { orientation: 0, groups: [{}] });
  });

  test("the fixture's two findings are the report's, and every row shows the API's figures", async () => {
    expect(report.opportunities.map((opportunity) => [opportunity.kind, opportunity.subject]).sort()).toEqual(
      [
        ["failed-tool-calls", fixture.savings.failedCallsProgram],
        ["unused-tools", fixture.savings.unusedToolsServer],
      ].sort(),
    );
    expect(opportunityOf("failed-tool-calls").opportunity.evidence.occurrences).toBe(fixture.savings.failedCallsCount);
    expect(opportunityOf("unused-tools").opportunity.sessions).toEqual([{ providerId: "vscode", sessionId: fixture.savings.localSessionId }]);
    expect(report.opportunities.every((opportunity) => opportunity.perWeek.known && opportunity.perWeek.currency === "AI_CREDITS")).toBe(true);

    await openSavings();
    const screen = await panel.inside(async () => readSavings());
    await saveScreenshot("sv1-savings-dark");

    expect(screen.lists.filter((name) => name !== "Not analysed")).toEqual(["AI Credits"]);
    expect(screen.rows).toHaveLength(report.opportunities.length);
    for (const [index, opportunity] of report.opportunities.entries()) {
      const expected = expectedRow(opportunity);
      expect(screen.rows[index]).toEqual({ list: expectedListName(opportunity), rank: String(index + 1), title: expected.title, subject: expected.subject, coverage: expected.coverage, amount: expected.amount });
    }
    // The estimated tokens and the upper bound are said in words.
    expect(screen.text).toContain("estimate");
    expect(screen.text).toMatch(/up to \d[\d,]*\.\d AI Credits per week/);
    expect(screen.text).toContain("Bars compare rows in this list only.");
    // No sum row; a reason may say "total tool-definition tokens", so only the label is searched for.
    expect(screen.text).not.toMatch(/\bTotal\b/);
  });

  test("it is Copilot only: the scope tag and the pointer to the standalone app, no Provider filter, the other sessions under Not analysed", async () => {
    await openSavings();
    const screen = await panel.inside(async () => readSavings());
    expect(screen.text).toContain("GitHub Copilot sessions only");
    expect(screen.text).toContain("Claude Code and pi savings are in the standalone app.");
    expect(await panel.inside(async () => hasProviderFilter())).toBe(false);

    expect(report.notAnalysed.length).toBeGreaterThan(0);
    expect(screen.notAnalysed).toHaveLength(report.notAnalysed.length);
    for (const [index, entry] of report.notAnalysed.entries()) {
      expect(screen.notAnalysed[index]).toContain(entry.reason);
      expect(screen.notAnalysed[index]).toContain(`${entry.sessions} ${entry.sessions === 1 ? "session" : "sessions"}`);
    }
  });

  test("a row opens its detail with Open session and Copy; Copy reaches the clipboard; Escape gives focus back", async () => {
    await openSavings();
    const { opportunity, index } = opportunityOf("unused-tools");
    await panel.inside(async () => openRow(index));
    const detail = await panel.inside(async () => readDetail());

    expect(detail.text).toContain(expectedRow(opportunity).amount);
    expect(detail.text).toContain("Suggestion only. This app does not change settings or files.");
    expect(detail.closeLabel).toBe("Close detail");
    expect(detail.sessionButtons).toContain(`Open session: ${fixture.savings.localSessionId}`);
    // Closed until asked for.
    expect(detail.versionsOpen).toBe(false);
    expect(detail.versionsSummary).toMatch(/^Price versions \(\d+\)$/);
    expect(detail.action.length).toBeGreaterThan(10);

    await panel.inside(async () => clickDetailButton("Copy text"));
    await browser.waitUntil(async () => (await panel.inside(async () => readDetail())).status === "Copied", { timeout: WAIT_MS, timeoutMsg: "Copy did not say Copied" });
    expect((await host.clipboardText()).replace(/\s+/g, " ").trim()).toBe(detail.action);
    await saveScreenshot("sv1-savings-detail");

    await panel.inside(async () => {
      await focusDetailButton("Copy text");
      await browser.keys(["Escape"]);
      await browser.waitUntil(async () => !(await readDetail()).text, { timeout: WAIT_MS, timeoutMsg: "Escape did not close the detail" });
      expect(await focusedRowIndex()).toBe(index);
    });
  });

  test("the failed-calls row's detail has the API's occurrence count and the Agent Host session", async () => {
    await openSavings();
    const { opportunity, index } = opportunityOf("failed-tool-calls");
    await panel.inside(async () => openRow(index));
    const detail = await panel.inside(async () => readDetail());
    expect(detail.text).toContain(expectedRow(opportunity).amount);
    expect(detail.text).toContain(`${fixture.savings.failedCallsCount} failed calls`);
    expect(detail.sessionButtons).toContain(`Open session: ${fixture.savings.agentHostSessionId}`);
  });

  for (const [theme, bodyClass] of [
    ["Default Dark Modern", "vscode-dark"],
    ["Default Light Modern", "vscode-light"],
    ["Default High Contrast", "vscode-high-contrast"],
  ] as const) {
    test(`the Savings view and its detail in ${theme}: every text reaches WCAG AA`, async () => {
      await host.setSetting(THEME_SETTING, theme);
      await openSavings();
      const findings = await panel.inside(async (view) => {
        await browser.waitUntil(async () => (await view.bodyClass()).split(" ").includes(bodyClass), { timeout: WAIT_MS, timeoutMsg: `the panel did not switch to ${bodyClass}` });
        const list = (await browser.execute(`return ${PROBE_SCRIPT}`)) as Probe;
        expect(list.texts.length).toBeGreaterThan(10);
        await openRow(0);
        const detail = (await browser.execute(`return ${PROBE_SCRIPT}`)) as Probe;
        return [...judgeProbe(list), ...judgeProbe(detail)];
      });
      await saveScreenshot(`sv1-savings-${bodyClass}`);
      expect(findings).toEqual([]);
    });
  }

  test("in a compact panel the detail replaces the list, with Back to the list, and nothing scrolls sideways", async () => {
    await host.setSetting(THEME_SETTING, undefined);
    await openSavings();
    const target = 360;
    let fraction = 1;
    let measured = await panel.inside((view) => view.width());
    for (let attempt = 0; attempt < 6 && !isWithinTolerance(measured, target); attempt++) {
      fraction = nextGroupFraction(fraction, measured, target);
      await host.command("vscode.setEditorLayout", { orientation: 0, groups: [{ size: fraction }, { size: 1 - fraction }] });
      await browser.pause(500);
      measured = await panel.inside((view) => view.width());
    }
    expect(isWithinTolerance(measured, target)).toBe(true);

    await panel.inside(async (view) => {
      // The width reaches the tab through a ResizeObserver, which needs a frame.
      await view.requestFrame();
      await openRow(0);
      await browser.waitUntil(async () => !(await readDetail()).listShown, { timeout: WAIT_MS, interval: 500, timeoutMsg: "the detail did not replace the list below 600 px" });
      expect((await readDetail()).closeLabel).toBe("Back to the list");
      await view.requestFrame();
      const { scrollWidth, clientWidth } = await view.horizontalOverflow();
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      await clickDetailButton("Back to the list");
      await browser.waitUntil(async () => (await readDetail()).listShown, { timeout: WAIT_MS, timeoutMsg: "Back to the list did not show the list" });
    });
    await saveScreenshot("sv1-savings-narrow");
  });
});
