// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { toolCallsIn } from "../support/call-log.js";
import { expect, test } from "../support/host-fixture.js";

// A24 §2.7 (docs/plans/mcp-apps-a24-checklist.md): U11 in Claude Desktop,
// dark, for a project. Customer portal across Claude Sonnet 5.5's
// documented 2026-10-07 cache-read cut (the fixture's price change, as in
// the web suite's MCP exit criterion), so the price effect is not zero.

test("A24 2.7 U11 project: period tiles, Change, Not explained, the waterfall and the model table; axe clean in Claude dark", async ({ host }) => {
  const view = await host.show("explain_cost_change", {
    groupBy: "project",
    id: "portal",
    periodA: { since: "2026-10-01", until: "2026-10-06" },
    periodB: { since: "2026-10-07", until: "2026-10-31" },
  });

  await expect(view.title()).toHaveText("Customer portal");
  await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Cost change");
  const u11 = view.costChange;
  // One block per currency; the first block carries every tile.
  await expect(u11.periodTile("A").first()).toBeVisible();
  await expect(u11.periodTile("B").first()).toBeVisible();
  for (const tile of ["Change", "Not explained"]) await expect(u11.tile(tile).first()).toBeVisible();
  await expect(u11.waterfall().first()).toBeVisible();
  await expect(u11.modelTable().first()).toBeVisible();
  await expect(view.footer()).toHaveText(/^Read-only · local logs · v\d+\.\d+\.\d+/);

  expect(await view.axeViolations()).toEqual([]);
  expect(toolCallsIn(host.calls)).toEqual([]);
});
