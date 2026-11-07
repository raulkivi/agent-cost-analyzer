// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Scenario R1 in the extension (Phase 14 step 14.7,
// docs/plans/analyze-session-replay.md §10 and §12 row 14.7, boards 1 to 5),
// driven in a real VS Code: a Copilot session replayed on model A, then B,
// then Compare models, with the replay strip and the Simulated cells
// readable in Dark Modern, Light Modern and High Contrast (S9's probe and
// judge). The standalone app's R1 (packages/web/e2e) checks every figure
// against the API; here the panel's own figures must agree with each other:
// the strip's simulated total is Compare models' total for that model.
//
// The session is the Agent Host fixture with usage records (the UI check's
// session-replay scenarios use it too): it is priced in AI Credits, so both
// models have a known total.
import { browser, expect } from "@wdio/globals";
import { COPILOT_CLI_FIXTURE_SESSION_IDS } from "../../../../server/src/test-support/copilot-cli-fixtures.ts";
import { judgeProbe, type Probe } from "../../../scripts/ui-check/judge.mts";
import { PROBE_SCRIPT } from "../../../scripts/ui-check/probe.mts";
import { AnalyzerPanel, type PanelView } from "../support/analyzer-panel.js";
import { saveScreenshot } from "../support/screenshots.js";
import { parseUiFixture, UI_FIXTURE_ENV } from "../support/ui-fixture-env.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const fixture = parseUiFixture(process.env[UI_FIXTURE_ENV]);
const panel = new AnalyzerPanel(host);
const THEME_SETTING = "workbench.colorTheme";
const SESSION_ID = COPILOT_CLI_FIXTURE_SESSION_IDS.usageRecords;
const MODEL_A = "claude-haiku-5.5";
const MODEL_B = "gpt-6.1-sol";
const WAIT_MS = 30_000;
// An AI Credits figure as the strip and the table write it.
const CREDITS = /^\d[\d,]*\.\d\d$/;

async function replayOn(view: PanelView, modelId: string): Promise<string> {
  await view.chooseReplayModel(modelId);
  let total: string | null = null;
  await browser.waitUntil(async () => (total = await view.replaySimulatedTotal(modelId)) !== null, {
    timeout: WAIT_MS,
    timeoutMsg: `the replay summary strip did not show a simulated total on ${modelId}`,
  });
  await browser.waitUntil(async () => (await view.simulatedColumns()).models.join() === modelId, {
    timeout: WAIT_MS,
    timeoutMsg: `the turns table did not show one Simulated group, on ${modelId}`,
  });
  return total!;
}

suite("Scenario R1: VS Code, replay a session on two models (step 14.7)", () => {
  suiteSetup(async () => {
    await host.waitForExtension({ userDataDir: fixture.userDataDir });
    await panel.reset();
  });

  suiteTeardown(async () => {
    await host.setSetting(THEME_SETTING, undefined);
  });

  test("Replay on A, then B, then Compare models lists both, with the measured model tagged", async () => {
    await panel.openSession(SESSION_ID);
    const [totalA, totalB, rows] = await panel.inside(async (view) => {
      await view.waitForTurnRows(1);
      const a = await replayOn(view, MODEL_A);
      expect((await view.simulatedColumns()).cells).toBeGreaterThan(0);
      const b = await replayOn(view, MODEL_B);
      await view.clickButton("Compare models");
      let compared: Awaited<ReturnType<PanelView["compareModelRows"]>> = [];
      await browser.waitUntil(
        async () => {
          compared = await view.compareModelRows();
          return [MODEL_A, MODEL_B].every((model) => compared.some((row) => row.model === model));
        },
        { timeout: WAIT_MS, timeoutMsg: `Compare models did not list ${MODEL_A} and ${MODEL_B}` },
      );
      return [a, b, compared] as const;
    });
    await saveScreenshot("r1-compare-models");

    expect(totalA).toMatch(CREDITS);
    expect(totalB).toMatch(CREDITS);
    expect(totalA).not.toEqual(totalB);
    // One answer in the panel: the strip's totals are the table's.
    expect(rows.find((row) => row.model === MODEL_A)?.total).toEqual(totalA);
    expect(rows.find((row) => row.model === MODEL_B)?.total).toEqual(totalB);
    // The session's own model is in the comparison, tagged, and only it.
    expect(rows.filter((row) => row.measured)).toHaveLength(1);
    expect(rows.find((row) => row.measured)?.model).not.toMatch(new RegExp(`^(${MODEL_A}|${MODEL_B})$`));
  });

  for (const [theme, bodyClass] of [
    ["Default Dark Modern", "vscode-dark"],
    ["Default Light Modern", "vscode-light"],
    ["Default High Contrast", "vscode-high-contrast"],
  ] as const) {
    test(`the replay strip and Simulated cells in ${theme}: every text reaches WCAG AA`, async () => {
      await host.setSetting(THEME_SETTING, theme);
      await panel.reset();
      await panel.openSession(SESSION_ID);
      const findings = await panel.inside(async (view) => {
        await browser.waitUntil(async () => (await view.bodyClass()).split(" ").includes(bodyClass), { timeout: WAIT_MS, timeoutMsg: `the panel did not switch to ${bodyClass}` });
        await view.waitForTurnRows(1);
        await replayOn(view, MODEL_B);
        expect((await view.simulatedColumns()).cells).toBeGreaterThan(0);
        const probed = (await browser.execute(`return ${PROBE_SCRIPT}`)) as Probe;
        expect(probed.texts.length).toBeGreaterThan(10);
        return judgeProbe(probed);
      });
      await saveScreenshot(`r1-replay-${bodyClass}`);
      expect(findings).toEqual([]);
    });
  }
});
