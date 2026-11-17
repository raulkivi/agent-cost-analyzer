// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import os from "node:os";
import { findForbidden, forbiddenTerms } from "../../../vscode-extension/scripts/demo/privacy-probe.mts";
import { play, totalBeatMs } from "../../../web/e2e/demo/support/demo-driver.js";
import { modelTurnsIn, toolCallsIn } from "../support/call-log.js";
import { expect, test } from "../support/host-fixture.js";
import { DEMO_MAX_BEAT_MS, F4, F4_ARGS, type DemoContext } from "./scenes.js";
import { applyDemoLayout, installPointer } from "./support/demo-setup.js";
import { recordScene } from "./support/record.js";

// The demo home (DR1): realistic model names and an unused-tools row.
test.use({ demoHome: true });

// F4 (docs/plans/demo-recordings-1.0.md §3.2): the savings view, a row open in place, Open replay, Back.
test("F4: savings row, replay, back", async ({ page, host }) => {
  await applyDemoLayout(page);
  const view = await host.show("get_savings_report", F4_ARGS);
  await expect(view.title()).toContainText("Possible savings");
  await expect(view.content.getByRole("button", { name: /Tools loaded but never used\s*acmedocs/ })).toBeVisible();
  // The privacy probe (DEMO_FORBIDDEN, the OS home and user name) reads the view and the host page URL at the row-open and replay beats.
  const forbidden = forbiddenTerms(process.env.DEMO_FORBIDDEN, { homedir: os.homedir(), username: os.userInfo().username });
  const context = { host, view } as unknown as DemoContext;
  context.probe = async () => {
    const text = await context.view.content.locator("body").innerText();
    const hits = findForbidden([{ source: "view", text: `${text}\n${page.url()}` }], forbidden);
    if (hits.length > 0) throw new Error(`Privacy probe: ${hits.map((hit) => `"${hit.match}" in ${hit.source}`).join("; ")}`);
  };
  const scene = F4(context);
  expect(totalBeatMs(scene)).toBeLessThan(DEMO_MAX_BEAT_MS);
  const pointer = await installPointer(page);

  await recordScene(page, scene, () => play(page, scene, pointer), async () => {
    // End state: back on the list, the replay's button focused; the replay was a plain tool call.
    await expect(context.view.title()).toContainText("Possible savings");
    expect(await context.view.focusedControl()).toMatch(/^Open replay for session /);
    expect(toolCallsIn(host.calls).map((call) => call.name)).toEqual(["replay_session"]);
    expect(modelTurnsIn(host.calls)).toEqual([]);
  });
});
