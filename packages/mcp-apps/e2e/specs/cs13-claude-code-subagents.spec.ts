// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { modelTurnsIn, toolCallsIn } from "../support/call-log.js";
import { expect, inEachClaudeSet, test, VSCODE_SETS } from "../support/host-fixture.js";
import { sessionCost } from "../../src/view-models/fixtures.js";
import { claudeRun, claudeTurnView, missingClaudeRun, priced } from "../../src/view-models/turn-view-fixture.js";

// CS13 (docs/plans/claude-code-subagents.md §5.6, board U1TurnDetail.dc.html):
// U1's expanded turn lists the subagent runs a Claude Code turn folded in,
// with tokens and a priced cost, and "AI Credits n/a". The fixture home has no
// such session, so the fake host answers get_turn with the shape the server
// returns (usage.subagents, usage.ownUsage and pricedCost). Claude light and
// dark, and the two VS Code sets, with axe.

const ARGS = { sessionId: "7f3a9c2e", provider: "claude-code" };
const missing = "The subagent transcript this turn started is missing.";

type Runs = Parameters<typeof claudeTurnView>[0];

function answers(runs: Runs, options?: Parameters<typeof claudeTurnView>[1]) {
  return { answers: { get_turn: claudeTurnView(runs, options) }, args: ARGS };
}

function define(): void {
  test("U1: expanding the turn lists the runs with tokens and priced cost, the runs' share under the cost, and AI Credits n/a; axe clean", async ({ host }) => {
    const runs = [claudeRun(), claudeRun({ id: "agent-b", label: "Agent-general-purpose", model: "claude-sonnet-5.5", roundsCount: 6, total: 730_000, cost: priced(0.29), attribution: "timestamp" })];
    const view = await host.showResult("get_session_cost", sessionCost(), answers(runs));
    const u1 = view.sessionCost;

    await u1.openTurn(17);
    const group = u1.pricedTurn();
    await expect(group).toBeVisible();
    await expect(group).toContainText("Tokens 2.54M");
    await expect(group).toContainText("Priced cost $0.59");
    await expect(group).toContainText("incl. $0.38 from 2 subagent runs");
    await expect(group).toContainText("AI Credits n/a");
    await expect(group).toContainText("Claude Code has no AI Credits");
    const items = group.getByRole("list", { name: "Subagent runs (2)" }).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("Explore");
    await expect(items.nth(0)).toContainText("9 requests");
    await expect(items.nth(0)).toContainText("1.31M tokens $0.09");
    await expect(items.nth(1)).toContainText("matched by time");
    await expect(group).toContainText("Main agent 0.50M · $0.21");
    await expect(group).toContainText("Subagent runs 2.04M · $0.38");
    await expect(group).toContainText("Turn 2.54M · $0.59");
    await expect(group).toContainText("Subagent runs are 80% of this turn's tokens and 64% of its priced cost.");
    expect(await view.axeViolations()).toEqual([]);

    expect(modelTurnsIn(host.calls)).toEqual([]);
    expect(toolCallsIn(host.calls).map((call) => call.name)).toEqual(["get_turn_series", "get_turn"]);
  });

  test("U1: an unknown run shows Unknown and its reason, never 0, and no smaller total; axe clean", async ({ host }) => {
    const view = await host.showResult("get_session_cost", sessionCost(), answers([claudeRun({ total: 220_000, cost: priced(0.02) }), missingClaudeRun()], { ownTotal: 310_000, ownCost: priced(0.19) }));
    await view.sessionCost.openTurn(17);
    const group = view.sessionCost.pricedTurn();
    await expect(group).toContainText("Tokens Unknown");
    await expect(group).toContainText("Priced cost Unknown");
    await expect(group).toContainText(`unknown: ${missing}`);
    const unknown = group.getByRole("listitem").nth(1);
    await expect(unknown).toContainText("model unknown");
    await expect(unknown).toContainText(missing);
    await expect(unknown).not.toContainText("$0.00");
    await expect(group).toContainText("Subagent runs unknown");
    await expect(group).toContainText("This turn's tokens and cost are unknown until the Plan run can be read.");
    expect(await view.axeViolations()).toEqual([]);
  });
}

inEachClaudeSet(define);

for (const set of VSCODE_SETS) {
  test.describe(`in VS Code, ${set.name ?? set.theme}`, () => {
    test.use({ hostKind: "vscode", hostSet: set });
    define();
  });
}
