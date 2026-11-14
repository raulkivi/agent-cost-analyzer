// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { play, totalBeatMs } from "../../../web/e2e/demo/support/demo-driver.js";
import { modelTurnsIn } from "../support/call-log.js";
import { expect, test } from "../support/host-fixture.js";
import { F2, F2_ARGS, FULLSCREEN, type DemoContext } from "./scenes.js";
import { applyDemoLayout, installPointer } from "./support/demo-setup.js";
import { recordScene } from "./support/record.js";

// F2 (docs/plans/docs-refresh-and-demo-recordings.md §4.2): waterfall colours, the price timeline and two currencies.
// The fixture's cost change is in USD only, so the currency switch is shown on the project's cost over time.
test("F2: cost change, price changes, Back; the currency switch", async ({ page, host }) => {
  await applyDemoLayout(page);
  const view = await host.show("explain_cost_change", F2_ARGS, FULLSCREEN);
  await expect(view.title()).toHaveText("Customer portal");
  await expect(view.costChange.waterfall().first()).toBeVisible();
  const context = { host, view } as DemoContext;
  const scene = F2(context);
  expect(totalBeatMs(scene)).toBeLessThan(20_000);
  const pointer = await installPointer(page);

  await recordScene(page, scene, async () => {
    await play(page, scene, pointer);

    // End state: the project's cost in AI Credits again, both currencies offered; U11 to U13 and back sent no message.
    await expect(context.view.costOverTime.chart()).toBeVisible();
    expect(await context.view.costOverTime.currencyOptions()).toEqual(["AI Credits", "USD"]);
    expect(await context.view.costOverTime.selectedCurrency()).toBe("AI Credits");
    expect(host.calls.some((call) => call.method === "tools/call" && call.name === "get_price_changes")).toBe(true);
    expect(modelTurnsIn(host.calls)).toEqual([]);
  });
});
