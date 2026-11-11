// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { toolCallsIn } from "../support/call-log.js";
import { APP_VERSION, expect, inEachClaudeSet, test } from "../support/host-fixture.js";
import type { McpHost } from "../support/mcp-host.js";

// The checklist rows that cut across views, in Claude Desktop, light and
// dark: A24 2.9 (narrow and fullscreen), 2.10 (drill-down calls) and 2.11
// (footer), and A16 §2's narrow, fullscreen and footer points for U1-U3.

const OCTOBER = { since: "2026-10-01", until: "2026-10-31" };
const SESSION = { sessionId: "1c7604a0-1488-4b5d-880a-f80fd693475e", provider: "vscode" };
const NARROW = { width: 360 };

const showU9 = (host: McpHost, options = {}) => host.show("get_project_cost", { projectId: "portal", since: "2026-08-09", until: "2026-11-06", bucket: "week" }, options);
const showU10 = (host: McpHost, options = {}) => host.show("compare_costs", { groupBy: "project", ids: ["portal", "billing", "mobile"], ...OCTOBER }, options);
const showU11 = (host: McpHost, options = {}) =>
  host.show("explain_cost_change", { groupBy: "project", id: "portal", periodA: { since: "2026-10-01", until: "2026-10-06" }, periodB: { since: "2026-10-07", until: "2026-10-31" } }, options);

inEachClaudeSet(() => {
  test("A24 2.9 narrow, 360 px: U9, U10 and U11 do not scroll sideways, and use their narrow layouts; axe clean", async ({ host }) => {
    const u9 = await showU9(host, NARROW);
    await expect(u9.title()).toHaveText("Customer portal");
    const u10 = await showU10(host, NARROW);
    await expect(u10.title()).toHaveText("3 projects compared");
    const u11 = await showU11(host, NARROW);
    await expect(u11.title()).toHaveText("Customer portal");

    for (const view of [u9, u10, u11]) {
      expect(await view.width()).toBeLessThanOrEqual(360);
      expect(await view.scrollsSideways()).toBe(false);
      expect(await view.axeViolations()).toEqual([]);
    }
    // U10: the per-session, per-day, per-turn and cache figures move under the row's name.
    await expect(u10.comparison.row("Customer portal").getByRole("rowheader")).toContainText(/per session.*per active day.*per turn.*cache hit/s);
    // U11: costs A and B drop out of the model table; the change and the effects stay.
    await expect(u11.costChange.modelColumn("Change")).toBeVisible();
    await expect(u11.costChange.modelColumn("Price")).toBeVisible();
    await expect(u11.costChange.modelColumn(/^2026-10-01/)).toHaveCount(0);
    await expect(u11.costChange.modelColumn(/^2026-10-07/)).toHaveCount(0);
  });

  // The checklist asks only whether fullscreen works for U9 (U9's own
  // fullscreen layout is task A31). It must render, in a window that is as wide as the screen.
  test("A24 2.9 fullscreen: Claude offers it and U9 renders in it without scrolling sideways (U9's own fullscreen layout is task A31)", async ({ host }) => {
    const view = await showU9(host, { displayMode: "fullscreen" });

    await expect(view.title()).toHaveText("Customer portal");
    await expect(view.costOverTime.chart()).toBeVisible();
    expect(await view.scrollsSideways()).toBe(false);
    expect(await view.axeViolations()).toEqual([]);
  });

  test("A24 2.10 drill-downs are exactly one plain tools/call each and nothing else; a fake host cannot show Claude's permission prompt, so whether Claude asks stays outside the gate", async ({ host }) => {
    const view = await showU10(host);

    await view.comparison.openRow("Customer portal");
    await expect(view.title()).toHaveText("Customer portal");
    expect(host.calls).toEqual([{ method: "tools/call", name: "get_project_cost", arguments: expect.objectContaining({ projectId: "portal" }) }]);

    // A top session: get_session_cost, then the app-only get_turn_series for its chart. Still only tools/call.
    await view.costOverTime.openSession("Fix the bug");
    await expect(view.sessionCost.turnChart()).toBeVisible();
    expect(host.calls.every((call) => call.method === "tools/call")).toBe(true);
    expect(toolCallsIn(host.calls).map((call) => call.name)).toEqual(["get_project_cost", "get_session_cost", "get_turn_series"]);
  });

  test("A24 2.10 a repository row is one plain get_repository_cost tools/call", async ({ host }) => {
    const view = await host.show("compare_costs", { groupBy: "repository", ids: ["github.com/acme/portal-web", "github.com/acme/billing"], ...OCTOBER });

    await view.comparison.openRow("github.com/acme/portal-web");
    await expect(view.kicker()).toHaveText("Agent Cost Analyzer · Cost comparison › Repository cost");
    expect(host.calls).toEqual([{ method: "tools/call", name: "get_repository_cost", arguments: expect.objectContaining({ repository: "github.com/acme/portal-web" }) }]);
  });

  test("A24 2.11 footer: every view ends with the product name's footer and the app's version", async ({ host }) => {
    const views = [
      await host.show("get_session_cost", SESSION),
      await host.show("get_cost_rollup", OCTOBER),
      await host.show("list_findings", {}),
      await showU9(host),
      await showU10(host),
      await showU11(host),
    ];

    for (const view of views) {
      await expect(view.kicker()).toHaveText(/^Agent Cost Analyzer · /);
      await expect(view.footer()).toHaveText(`Read-only · local logs · v${APP_VERSION}`);
    }
  });

  test("A16 2 narrow, 360 px: U1, U2 and U3 do not scroll sideways; axe clean", async ({ host }) => {
    const views = [await host.show("get_session_cost", SESSION, NARROW), await host.show("get_cost_rollup", OCTOBER, NARROW), await host.show("list_findings", {}, NARROW)];

    for (const view of views) {
      await expect(view.title()).toBeVisible();
      expect(await view.width()).toBeLessThanOrEqual(360);
      expect(await view.scrollsSideways()).toBe(false);
      expect(await view.axeViolations()).toEqual([]);
    }
  });

  test("A16 2 fullscreen: Claude offers it and U1, U2 and U3 render in it; axe clean", async ({ host }) => {
    const views = [
      await host.show("get_session_cost", SESSION, { displayMode: "fullscreen" }),
      await host.show("get_cost_rollup", OCTOBER, { displayMode: "fullscreen" }),
      await host.show("list_findings", {}, { displayMode: "fullscreen" }),
    ];

    for (const view of views) {
      await expect(view.title()).toBeVisible();
      expect(await view.scrollsSideways()).toBe(false);
      expect(await view.axeViolations()).toEqual([]);
    }
  });
});
