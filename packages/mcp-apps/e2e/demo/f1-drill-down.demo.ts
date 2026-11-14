// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { play, totalBeatMs } from "../../../web/e2e/demo/support/demo-driver.js";
import { modelTurnsIn } from "../support/call-log.js";
import { expect, test } from "../support/host-fixture.js";
import { F1, F1_ARGS, FULLSCREEN, type DemoContext } from "./scenes.js";
import { applyDemoLayout, installPointer } from "./support/demo-setup.js";
import { recordScene } from "./support/record.js";

// F1 (docs/plans/docs-refresh-and-demo-recordings.md §4.2): the drill-down chain and focus return.
test("F1: comparison, cost over time, session cost, turn; Back at each level", async ({ page, host }) => {
  await applyDemoLayout(page);
  const view = await host.show("compare_costs", F1_ARGS, FULLSCREEN);
  await expect(view.title()).toHaveText("3 projects compared");
  await expect(view.comparison.table("project")).toBeVisible();
  const context = { host, view } as DemoContext;
  const scene = F1(context);
  expect(totalBeatMs(scene)).toBeLessThan(20_000);
  const pointer = await installPointer(page);

  await recordScene(page, scene, async () => {
    await play(page, scene, pointer);

    // End state: back on the comparison, focus on the project row the chain started from.
    await expect(context.view.title()).toHaveText("3 projects compared");
    await expect.poll(() => context.view.focusedControl()).toBe("Customer portal");
    expect(modelTurnsIn(host.calls), "a drill-down never starts a model turn").toEqual([]);
  });
});
