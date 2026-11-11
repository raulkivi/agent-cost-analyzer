// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { APP_VERSION, expect, inEachClaudeSet, test } from "../support/host-fixture.js";
import type { McpHost } from "../support/mcp-host.js";

// A33 (docs/plans/mcp-apps.md §8.3): the Increment 3 rows that cut across
// views, in Claude Desktop light and dark, as A24 2.10 and 2.11 do for
// Increment 2. Each view's own rows are in u12-replay, u13-price-changes,
// u14-u15-billing, a30-audit-picker and a32-coverage-gaps.
//   - Footer: every Increment 3 view names the product in its kicker and ends
//     with the read-only footer and the app's version.
//   - Drill-downs: U12's model → replay and U11 → U13 are exactly one plain
//     tools/call each, and nothing else reaches the host (no message, no
//     model context, no link, no display mode). Whether Claude Desktop asks
//     for permission before such a call is outside the gate: a fake host has
//     no permission prompt (risk R4, A24 2.10).

const PROVIDER = "claude-code";
const OCTOBER = { since: "2026-10-01", until: "2026-10-31" };
const MODEL = "gpt-6.1-sol";

// The fixture home's two-turn Claude Code session of 2026-10-05 (as u12-replay.spec.ts finds it).
async function replaySession(host: McpHost): Promise<{ sessionId: string; provider: string }> {
  const { sessions } = (await host.lookup("list_sessions", { provider: PROVIDER })) as { sessions: { id: string; startedAt?: string }[] };
  const found = sessions.find((session) => session.startedAt === "2026-10-05T09:00:00.000Z");
  expect(found, "the fixture home's 2026-10-05 session").toBeDefined();
  return { sessionId: found!.id, provider: PROVIDER };
}

inEachClaudeSet(() => {
  test("A33 §8.3 footer: every Increment 3 view (U4 session and rollup, U5, U12 compare and replay, U13, U14, U15) names the product in its kicker and ends with Read-only · local logs · v<app version>; axe clean", async ({ host }) => {
    const session = await replaySession(host);
    const shows: [string, Record<string, unknown>][] = [
      ["get_session_audit", session],
      ["get_audit_rollup", { provider: PROVIDER, ...OCTOBER }],
      ["list_sessions", { provider: PROVIDER, ...OCTOBER }],
      ["compare_models_for_session", { ...session, models: [MODEL] }],
      ["replay_session", { ...session, model: MODEL }],
      ["get_price_changes", { since: "2026-09-01", until: "2026-10-31" }],
      ["get_statement", { projectId: "portal", period: "2026-10" }],
      ["estimate_cost", { projectId: "portal", activeDays: 10 }],
    ];

    for (const [tool, args] of shows) {
      const view = await host.show(tool, args);
      await expect(view.kicker(), tool).toHaveText(/^Agent Cost Analyzer · /);
      await expect(view.footer(), tool).toHaveText(`Read-only · local logs · v${APP_VERSION}`);
      expect(await view.axeViolations(), tool).toEqual([]);
    }
  });

  test("A33 §8.3 drill-downs: U12's model → replay and U11 → U13 are exactly one plain tools/call each and nothing else; a fake host cannot show Claude's permission prompt, so whether Claude asks stays outside the gate", async ({ host }) => {
    const session = await replaySession(host);
    const u12 = await host.show("compare_models_for_session", { ...session, models: [MODEL] });
    await u12.replay.modelButton(MODEL).click();
    await expect(u12.title()).toContainText(`Replay on ${MODEL}`);
    await u12.back("Back to model comparison");
    await expect(u12.title()).toContainText("Replay on other models");
    expect(host.calls).toEqual([{ method: "tools/call", name: "replay_session", arguments: { sessionId: session.sessionId, model: MODEL, provider: PROVIDER } }]);
    expect(await u12.axeViolations()).toEqual([]);

    const before = { since: "2026-10-01", until: "2026-10-06" };
    const after = { since: "2026-10-07", until: "2026-10-31" };
    const u11 = await host.show("explain_cost_change", { groupBy: "project", id: "portal", periodA: before, periodB: after });
    const callsBefore = host.calls.length;
    await u11.costChange.openPriceChanges();
    await expect(u11.title()).toHaveText("Price changes behind the cost change");
    await u11.back("Back to cost change");
    await expect(u11.title()).toHaveText("Customer portal");
    expect(host.calls.slice(callsBefore)).toEqual([{ method: "tools/call", name: "get_price_changes", arguments: { since: before.since, until: after.until } }]);
    expect(await u11.axeViolations()).toEqual([]);
  });
});
