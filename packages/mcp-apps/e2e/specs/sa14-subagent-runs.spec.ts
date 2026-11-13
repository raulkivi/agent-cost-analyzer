// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { modelTurnsIn, toolCallsIn } from "../support/call-log.js";
import { expect, inEachClaudeSet, test, VSCODE_SETS } from "../support/host-fixture.js";
import { sessionCost } from "../../src/view-models/fixtures.js";
import { subagentRun, turnViewWithRuns } from "../../src/view-models/turn-view-fixture.js";

// SA14 (docs/plans/classic-subagent-credits-implementation.md §6-7, board
// U1TurnDetail.dc.html): U1's expanded turn lists the subagent runs a classic
// Copilot Chat turn folded in. The fixture home has no such session, so the
// fake host answers get_turn with the shape the server returns (usage.subagents
// and usage.ownUsage). Claude light and dark, and the two VS Code sets, with axe.

const ARGS = { sessionId: "7f3a9c2e", provider: "vscode" };
const missing = "The subagent log runSubagent-Plan this turn started is missing.";

function answers(runs: Parameters<typeof turnViewWithRuns>[0]) {
  return { answers: { get_turn: turnViewWithRuns(runs) }, args: ARGS };
}

function define(): void {
  test("U1: expanding the turn with runs lists them by agent name, with the marker note, the shares and a matched-by-time cue; axe clean", async ({ host }) => {
    const runs = [subagentRun(), subagentRun({ id: "call_b", label: "runSubagent-Plan", agentName: "Plan", roundsCount: 9, costAiCredits: { known: true, value: 11.95 }, attribution: "timestamp" })];
    const view = await host.showResult("get_session_cost", sessionCost(), answers(runs));
    const u1 = view.sessionCost;

    await u1.openTurn(17);
    await expect(u1.subagentRuns()).toBeVisible();
    await expect(u1.subagentRuns()).toContainText("Subagent runs (2)");
    await expect(u1.subagentRuns()).toContainText("incl. 42.06 from 2 subagent runs, matched by time");
    await expect(u1.subagentRuns().getByRole("listitem")).toHaveCount(2);
    await expect(u1.subagentRuns().getByRole("listitem").nth(0)).toContainText("Explore");
    await expect(u1.subagentRuns().getByRole("listitem").nth(0)).toContainText("14 requests");
    await expect(u1.subagentRuns().getByRole("listitem").nth(1)).toContainText("matched by time");
    await expect(u1.subagentRuns()).toContainText("Main agent 4.25");
    expect(await view.axeViolations()).toEqual([]);

    expect(modelTurnsIn(host.calls)).toEqual([]);
    expect(toolCallsIn(host.calls).map((call) => call.name)).toEqual(["get_turn_series", "get_turn"]);
  });

  test("U1: a run at 0.00 keeps the marker; an unknown run shows Unknown and its reason, never 0; axe clean", async ({ host }) => {
    const zero = await host.showResult("get_session_cost", sessionCost(), answers([subagentRun({ label: "searchSubagent", agentName: undefined, roundsCount: 0, costAiCredits: { known: true, value: 0 } })]));
    await zero.sessionCost.openTurn(17);
    await expect(zero.sessionCost.subagentRuns()).toContainText("incl. 0.00 from 1 subagent run");
    await expect(zero.sessionCost.subagentRuns().getByRole("listitem")).toContainText("searchSubagent");
    expect(await zero.axeViolations()).toEqual([]);

    const view = await host.showResult("get_session_cost", sessionCost(), answers([subagentRun(), subagentRun({ id: "call_b", label: "runSubagent-Plan", agentName: "Plan", model: "", costAiCredits: { known: false, reason: missing } })]));
    await view.sessionCost.openTurn(17);
    const unknown = view.sessionCost.subagentRuns().getByRole("listitem").nth(1);
    await expect(unknown).toContainText("Unknown");
    await expect(unknown).toContainText("model unknown");
    await expect(unknown).toContainText(missing);
    await expect(unknown).not.toContainText("0.00");
    await expect(view.sessionCost.subagentRuns()).toContainText(`unknown: ${missing}`);
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
