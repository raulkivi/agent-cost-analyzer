// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { costSeriesSchema, statementAnswerSchema, type TokenCount } from "@agent-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { composeCostFixture, copilotSessions, sessionOf, turnOf, usage } from "../../test-support/cost-analysis-fixture.js";
import { foldRuns, subagentRun } from "../../test-support/subagent-usage-fakes.js";

// Step 10.19 SA10 (classic subagents plan §4.5): the cost fixture plus one
// classic Copilot session whose turn ran a subagent on another model, over
// the real pricing (the bundled price book), attribution, Insights dataset,
// cube, statements and price changes. The main agent works on Claude Sonnet
// 5.5 with cp-1's second turn's tokens; its run on GPT-6.1 Sol with cp-2's.
// So each line must price exactly as those turns do, and bill on its own
// model.

const k = (value: number): TokenCount => ({ known: true, value });

const own = usage("claude-sonnet-5.5", { uncachedInput: k(1000), cacheRead: k(9000), output: k(500), costAiCredits: k(0.9) });
const run = subagentRun({ model: "gpt-6.1-sol", roundsCount: 1, uncachedInput: k(2000), cacheWrite: k(0), cacheRead: k(0), reasoning: k(0), output: k(1000), costAiCredits: k(2.5) });
const withRun = sessionOf("cp-run", "vscode", "/home/dev/billing", [turnOf(0, "2026-10-21T09:00:00.000Z", foldRuns(own, [run]))]);

describe("a classic Copilot turn with a subagent run, through the cost stack", () => {
  const plain = composeCostFixture();
  const fixture = composeCostFixture({ copilot: [...copilotSessions, withRun] });

  it("prices the main agent's tokens on Sonnet and the run's on Sol, and credits each model in get_session_cost", async () => {
    const cost = (await fixture.deps.analysisQueries!.getSessionCost("cp-run", "vscode"))!;
    const sonnet = (await plain.deps.analysisQueries!.getSessionCost("cp-1", "vscode"))!.topTurns.find((turn) => turn.turnIndex === 1)!.cost.priced;
    const sol = (await plain.deps.analysisQueries!.getSessionCost("cp-2", "vscode"))!.topTurns[0]!.cost.priced;
    expect(sonnet.known && sol.known).toBe(true);
    expect(cost.turnCount).toBe(1);
    expect(cost.totals.aiCredits.value).toBeCloseTo(3.4, 10);
    expect(cost.topTurns[0]!.cost.priced).toMatchObject({ known: true, amount: expect.closeTo((sonnet.known ? sonnet.amount : 0) + (sol.known ? sol.amount : 0), 9) });
    expect(cost.byModel.map((entry) => [entry.model, entry.turns, entry.aiCredits])).toEqual([
      ["gpt-6.1-sol", 1, 2.5],
      ["claude-sonnet-5.5", 1, 0.9],
    ]);
  });

  it("bills the billing project's statement per line's model, the turn counted once", async () => {
    const before = statementAnswerSchema.parse(await plain.statements.get({ projectId: "billing", period: "2026-10" })).statement;
    const after = statementAnswerSchema.parse(await fixture.statements.get({ projectId: "billing", period: "2026-10" })).statement;
    const billedLines = (statement: typeof after) => statement.lines.filter((line) => line.basis === "billed").map((line) => [line.model, line.turns, line.amount]);
    expect(billedLines(before)).toEqual([["gpt-6.1-sol", 1, 2.5]]);
    expect(billedLines(after)).toEqual([
      ["claude-sonnet-5.5", 1, 0.9],
      ["gpt-6.1-sol", 2, 5],
    ]);
    expect(after.coverage.turns).toBe(before.coverage.turns + 1);
  });

  it("splits the cost over time by model, and finds no observed price change", async () => {
    const series = costSeriesSchema.parse(await fixture.api.getCostTimeSeries({ groupBy: "model", basis: "billed", since: "2026-10-01", until: "2026-10-31" }));
    // Sol: cp-2, cp-3, pi-1's two turns, and the run; billed only on Copilot's two known turns.
    const sol = series.series.find((line) => line.key === "gpt-6.1-sol")!;
    expect(sol.turns).toBe(5);
    expect(sol.total.amounts).toEqual([{ currency: "AI_CREDITS", amount: 5, knownTurns: 2 }]);
    expect(series.series.find((line) => line.key === "claude-sonnet-5.5")!.total.amounts[0]).toMatchObject({ amount: expect.closeTo(2.8, 10), knownTurns: 3 });
    const plainSeries = await plain.api.getCostTimeSeries({ groupBy: "model", basis: "billed", since: "2026-10-01", until: "2026-10-31" });
    expect(series.turns).toBe(plainSeries.turns + 1);
    expect(series.observedChanges).toEqual([]);
  });
});
