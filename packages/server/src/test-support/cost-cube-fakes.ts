// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostFigure, CostLine, TurnCostFigures } from "@agent-cost-analyzer/domain";
import type { CostCube, CostCubeRow } from "../services/cost-analysis/cost-cube.js";

// Hand-written cost-cube rows for the step 15.7 builder tests: each test
// states its own figures.

const NONE: CostFigure = { known: false, reason: "not recorded" };

export const billed = (amount: number): CostFigure => ({ known: true, amount, currency: "AI_CREDITS", basis: "billed" });
export const reported = (amount: number): CostFigure => ({ known: true, amount, currency: "USD", basis: "reported" });
export const priced = (amount: number, versionId: string, currency: "USD" | "AI_CREDITS" = "USD"): CostFigure => ({
  known: true,
  amount,
  currency,
  basis: "priced",
  priceVersionIds: [versionId],
});
export const unknownFigure = (reason = "no price"): CostFigure => ({ known: false, reason });

export function costs(figures: Partial<TurnCostFigures>): TurnCostFigures {
  return { billed: NONE, reported: NONE, priced: NONE, ...figures };
}

let counter = 0;

export function cubeRow(overrides: Partial<CostCubeRow> & Pick<CostCubeRow, "date">): CostCubeRow {
  counter += 1;
  const sessionKey = overrides.sessionKey ?? `p:s${counter}`;
  return {
    turnKey: `${sessionKey}:${counter}`,
    sessionKey,
    providerId: "p",
    sessionId: sessionKey.split(":")[1] ?? sessionKey,
    sessionTitle: `Session ${sessionKey}`,
    sessionModel: overrides.model ?? "m",
    model: "m",
    repositoryKey: "github.com/acme/app",
    projectId: "app",
    vendorId: "anthropic",
    channel: "anthropic-api",
    uncachedInput: 100,
    cacheWrite: 0,
    cacheRead: 300,
    reasoning: null,
    output: 100,
    aiCredits: null,
    estimated: false,
    cost: costs({}),
    ...overrides,
  };
}

export function cubeOf(rows: CostCubeRow[], undatedTurns = 0): CostCube {
  const names: Record<string, string> = { app: "App", portal: "Customer portal" };
  const vendors: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI" };
  return {
    generatedAt: "2026-11-06T00:00:00.000Z",
    providers: [{ id: "p", label: "P", available: true, sessionCount: 1, truncated: false }],
    rows,
    undatedTurns,
    projectName: (id) => names[id] ?? id,
    vendorLabel: (id) => vendors[id] ?? id,
  };
}

// Step 10.19: one cost line of a turn that ran subagents (plan §4.5).
export function costLine(model: string, vendorId: string | null, cost: TurnCostFigures, overrides: Partial<CostLine> = {}): CostLine {
  return {
    model,
    vendorId,
    uncachedInput: 100,
    cacheWrite: 0,
    cacheRead: 300,
    reasoning: null,
    output: 100,
    aiCredits: null,
    cost,
    subagent: model !== "main",
    ...overrides,
  };
}
