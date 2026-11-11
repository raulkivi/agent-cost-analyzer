// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { toolCallsIn } from "../support/call-log.js";
import { expect, test } from "../support/host-fixture.js";

// A24 §2.1 (docs/plans/mcp-apps-a24-checklist.md): U9 for a repository in
// Claude Desktop, dark. The fixture home's portal-web has Claude Code turns
// (priced; one in September before the price book's first price, so
// unknown) and a Copilot session (billed), and no pi turns, so Reported
// knows nothing.

test("A24 2.1 U9 repository: title, four basis tiles, cost chart, footer; axe clean in Claude dark", async ({ host }) => {
  const view = await host.show("get_repository_cost", { repository: "github.com/acme/portal-web", since: "2026-08-09", until: "2026-11-06", bucket: "week" });

  await expect(view.title()).toHaveText("github.com/acme/portal-web");
  await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Repository cost");
  const u9 = view.costOverTime;
  for (const tile of ["Total · preferred basis", "Billed", "Reported", "Priced"] as const) await expect(u9.basisTile(tile)).toBeVisible();
  await expect(u9.basisTile("Billed")).toContainText("AI Credits");
  // Nothing reported for this repository: Unknown, never 0.
  await expect(u9.basisTile("Reported")).toContainText("Unknown");
  await expect(u9.chart()).toBeVisible();
  // A repository shows no top sessions (§9.1 answer 2).
  await expect(u9.topSessions()).toHaveCount(0);
  await expect(view.footer()).toHaveText(/^Read-only · local logs · v\d+\.\d+\.\d+/);

  expect(await view.axeViolations()).toEqual([]);
  // The first render is the model's own call; the view asked for nothing more.
  expect(toolCallsIn(host.calls)).toEqual([]);
});
