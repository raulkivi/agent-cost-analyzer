// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  unavailableTokenCount,
  type CostFigure,
  type InsightsDataset,
  type InsightTurnRow,
  type Session,
  type SubagentRunUsage,
  type TokenCount,
  type TurnUsage,
} from "@agent-cost-analyzer/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { analyzeSession, providerSessions, turn } from "../../test-support/insights-fakes.js";
import { foldRuns } from "../../test-support/subagent-usage-fakes.js";
import type { Attribution } from "../cost-attribution/session-attributor.js";
import { buildCostRollup } from "../cost/cost-rollup-builder.js";
import { buildCostCube } from "../cost-analysis/cost-cube.js";
import { buildCostSeries } from "../cost-analysis/time-series-builder.js";
import type { PricingRequest } from "../pricing/cost-pricer.js";
import { TurnCostFigureBuilder } from "../pricing/turn-cost-figures.js";
import { buildInsightRows, type RowAttributor } from "./insights-dataset-builder.js";

// Step 10.19 (classic subagents plan §4.5, SA10 exit): for any turn the
// reader folds subagent runs into, its cost lines sum to its row on every
// figure when the row is known; an unknown row never has lines that sum to
// a known figure, and is never 0; per-model totals add up to the overall
// total; and a turn is still one row.

const MODELS = ["claude-sonnet-5.5", "gpt-6.1-sol", "claude-haiku-5"] as const;
const FIGURES = ["uncachedInput", "cacheWrite", "cacheRead", "reasoning", "output", "aiCredits"] as const;
const RATE: Record<string, number> = { "claude-sonnet-5.5": 3, "gpt-6.1-sol": 2, "claude-haiku-5": 1 };

const count = (max: number) =>
  fc.option(fc.integer({ min: 0, max }), { nil: null }).map((value): TokenCount => (value === null ? unavailableTokenCount("not recorded") : { known: true, value }));
const credits = fc
  .option(fc.integer({ min: 0, max: 500 }), { nil: null })
  .map((value): TokenCount => (value === null ? unavailableTokenCount("no AI Credits") : { known: true, value: value / 100 }));

const ownUsage = fc.record({
  uncachedInput: count(10_000),
  cacheWrite: count(1_000),
  cacheRead: count(50_000),
  reasoning: count(500),
  output: count(2_000),
  costAiCredits: credits,
  model: fc.constantFrom(...MODELS),
}).map(
  (figures): TurnUsage => ({
    ...figures,
    tool: unavailableTokenCount("not exposed"),
    vision: unavailableTokenCount("not exposed"),
    roundsCount: 1,
  }),
);

const runUsage = fc.record({
  uncachedInput: count(10_000),
  cacheWrite: count(1_000),
  cacheRead: count(50_000),
  reasoning: count(500),
  output: count(2_000),
  costAiCredits: credits,
  model: fc.constantFrom(...MODELS),
}).map((figures): SubagentRunUsage => ({ ...figures, id: "toolu_run", label: "runSubagent-Explore", roundsCount: 1, attribution: "child-session-ref" }));

// A turn with no runs, or the reader's fold of its runs and maybe an unread one.
const turnUsage = fc.oneof(
  ownUsage,
  fc.tuple(ownUsage, fc.array(runUsage, { maxLength: 3 }), fc.option(fc.constant("The subagent log is missing."), { nil: undefined })).map(([own, runs, unread]) =>
    foldRuns(own, runs, unread),
  ),
);

// Priced on the request's own model; unknown when a token count is.
const pricer = new TurnCostFigureBuilder({
  price: (request: PricingRequest): CostFigure => {
    const { uncachedInput, cacheRead, output, model } = request.usage;
    const rate = RATE[model];
    if (rate === undefined || !uncachedInput.known || !cacheRead.known || !output.known) return { known: false, reason: `Cannot price ${model}` };
    const parts = { uncachedInput: uncachedInput.value * rate, cacheRead: (cacheRead.value * rate) / 10, cacheWrite: 0, output: output.value * rate * 4 };
    const amount = parts.uncachedInput + parts.cacheRead + parts.output;
    return { known: true, amount, currency: "AI_CREDITS", basis: "priced", priceVersionIds: [`gh:${model}`], byTokenType: parts };
  },
});

const base: Attribution = {
  repository: { attributed: true, repository: { key: "github.com/acme/app", source: "git-remote" } },
  projectId: "app",
  vendor: { known: true, vendorId: "anthropic", basis: "profile" },
  channel: { known: true, channel: "github-copilot" },
};
const vendorOf = (model: string): Attribution["vendor"] =>
  model.startsWith("gpt") ? { known: true, vendorId: "openai", basis: "profile" } : model.startsWith("claude") ? base.vendor : { known: false, reason: "No vendor profile lists the model." };
const attributor: RowAttributor = { session: () => base, turn: (_providerId, _session, t) => ({ ...base, vendor: vendorOf(t.usage.model) }) };

function datasetOf(usages: TurnUsage[][]): { dataset: InsightsDataset; sessions: Session[] } {
  const sessions = usages.map((turns, index) =>
    analyzeSession(`s${index}`, `2026-10-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`, turns.map((usage, turnIndex) => turn(turnIndex, [], usage))),
  );
  const rows = buildInsightRows([providerSessions(sessions, "vscode", "VS Code")], attributor, pricer);
  const dataset: InsightsDataset = {
    generatedAt: "2026-11-06T00:00:00.000Z",
    providers: [{ id: "vscode", label: "VS Code", available: true, sessionCount: sessions.length, truncated: false }],
    sessions: rows.sessions,
    turns: rows.turns,
    toolCalls: rows.toolCalls,
    findings: [],
  };
  return { dataset, sessions };
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const anyPartUnknown = (usage: TurnUsage, field: "costAiCredits") => !usage[field].known;

function expectLinesSumToRow(row: InsightTurnRow): void {
  const lines = row.lines!;
  for (const field of FIGURES) {
    const total = row[field];
    if (total === null) {
      // Unknown: never known lines that add up to a figure the row lacks.
      expect(lines.some((line) => line[field] === null)).toBe(true);
    } else {
      expect(lines.every((line) => line[field] !== null)).toBe(true);
      expect(close(lines.reduce((sum, line) => sum + line[field]!, 0), total)).toBe(true);
    }
  }
  for (const basis of ["billed", "priced"] as const) {
    const figure = row.cost![basis];
    const parts = lines.map((line) => line.cost![basis]);
    expect(parts.every((part) => part.known)).toBe(figure.known);
    if (figure.known) expect(close(parts.reduce((sum, part) => sum + (part.known ? part.amount : 0), 0), figure.amount)).toBe(true);
  }
}

describe("cost lines (properties)", () => {
  it("sum to their row when it is known, never to a known figure when it isn't, and keep one row per turn", () => {
    fc.assert(
      fc.property(fc.array(fc.array(turnUsage, { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 4 }), (usages) => {
        const { dataset } = datasetOf(usages);
        const flat = usages.flat();
        expect(dataset.turns).toHaveLength(flat.length);
        dataset.turns.forEach((row, index) => {
          const usage = flat[index]!;
          expect(row.lines !== undefined).toBe(usage.subagents !== undefined);
          // Unknown is null, never 0: the folded AI Credits are unknown exactly when the reader's are.
          expect(row.aiCredits === null).toBe(anyPartUnknown(usage, "costAiCredits"));
          if (row.lines) expectLinesSumToRow(row);
        });
      }),
    );
  });

  it("add up per model to the overall total, with each turn counted once per model it used", () => {
    fc.assert(
      fc.property(fc.array(fc.array(turnUsage, { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 4 }), (usages) => {
        const { dataset } = datasetOf(usages);
        const rollup = buildCostRollup(dataset);
        expect(rollup.turnCount).toBe(dataset.turns.length);
        const modelsUsed = (row: InsightTurnRow) => new Set((row.lines ?? [row]).map((line) => line.model));
        for (const entry of rollup.byModel) {
          expect(entry.turns).toBe(dataset.turns.filter((row) => modelsUsed(row).has(entry.model)).length);
        }
        if (dataset.turns.every((row) => row.aiCredits !== null)) {
          const byModel = rollup.byModel.reduce((sum, entry) => sum + entry.aiCredits!, 0);
          expect(close(byModel, rollup.totals.aiCredits.value!)).toBe(true);
        }

        const cube = buildCostCube(dataset);
        const series = buildCostSeries(cube, { bucket: "month", basis: "billed", pricing: "as-of-use", currency: "native", groupBy: "model" }, []);
        expect(series.turns).toBe(dataset.turns.length);
        if (dataset.turns.every((row) => row.cost!.billed.known)) {
          const perModel = series.series.reduce((sum, line) => sum + (line.total.amounts[0]?.amount ?? 0), 0);
          expect(close(perModel, series.total.amounts[0]?.amount ?? 0)).toBe(true);
        }
      }),
    );
  });
});
