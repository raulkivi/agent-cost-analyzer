// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { unavailableTokenCount, type Session, type SavingsWindow, type ToolInventoryEntry, type Turn } from "@agent-cost-analyzer/domain";
import { BundledPriceBookSource, defaultPriceBookDir } from "../services/pricing/bundled-price-book-source.js";
import { CostPricer } from "../services/pricing/cost-pricer.js";
import { PriceBook } from "../services/pricing/price-book.js";
import { CandidatePriceModelMapper } from "../services/pricing/price-model-mapper.js";
import { CounterfactualPricer } from "../services/savings/counterfactual-pricer.js";
import type { SavingsInput, SavingsSessionInput } from "../services/savings/savings-detector.js";

// Builders for the Phase 16 detector tests: synthetic content only (no prompt
// or response text), priced from the bundled price book.

const book = new PriceBook(new BundledPriceBookSource(defaultPriceBookDir())).snapshot();

export const SAVINGS_NOW = new Date("2026-11-06T10:00:00Z");
export const WINDOW: SavingsWindow = { since: "2026-10-07", until: "2026-11-06", days: 30 };
export const ANTHROPIC = { known: true, channel: "anthropic-api" } as const;
export const COPILOT = { known: true, channel: "github-copilot" } as const;

export function counterfactualPricer(): CounterfactualPricer {
  return new CounterfactualPricer(new CostPricer({ prices: book, models: new CandidatePriceModelMapper(book), now: () => SAVINGS_NOW }));
}

export function tool(name: string, definitionTokens: number | null, invokedInTurns: number[] = [], loaded = true): ToolInventoryEntry {
  return {
    name,
    loaded,
    invokedInTurns,
    ...(definitionTokens === null
      ? { definitionTokens: unavailableTokenCount("The tools file is missing.") }
      : { definitionTokens: { known: true, value: definitionTokens, estimated: true } }),
  };
}

export function turn(index: number, overrides: Partial<Turn> = {}): Turn {
  return {
    index,
    userMessage: "",
    assistantResponse: "",
    toolCalls: [],
    usage: {
      uncachedInput: { known: true, value: 1000 },
      cacheWrite: { known: true, value: 0 },
      cacheRead: { known: true, value: 0 },
      tool: unavailableTokenCount("x"),
      vision: unavailableTokenCount("x"),
      reasoning: unavailableTokenCount("x"),
      output: { known: true, value: 100 },
      costAiCredits: unavailableTokenCount("x"),
      model: "claude-sonnet-5",
      roundsCount: 1,
    },
    explanation: "",
    ...overrides,
  };
}

export function session(id: string, overrides: Partial<Session> = {}): Session {
  const turns = overrides.turns ?? [turn(0)];
  return {
    id,
    mode: "analyze",
    providerId: "claude-code",
    title: `Session ${id}`,
    model: "claude-sonnet-5",
    turns,
    turnCount: turns.length,
    costAiCredits: unavailableTokenCount("x"),
    usageDataAvailable: true,
    startedAt: "2026-10-15T12:00:00Z",
    ...overrides,
  };
}

// `rounds`: one entry per turn, its roundsCount.
export function withRounds(rounds: readonly number[], model = "claude-sonnet-5"): Turn[] {
  return rounds.map((roundsCount, index) => turn(index, { usage: { ...turn(index).usage, model, roundsCount } }));
}

export function sessionInput(sessionValue: Session, overrides: Partial<SavingsSessionInput> = {}): SavingsSessionInput {
  return { providerId: sessionValue.providerId ?? "claude-code", session: sessionValue, channel: ANTHROPIC, ...overrides };
}

export function savingsInput(sessions: SavingsSessionInput[], overrides: Partial<SavingsInput> = {}): SavingsInput {
  return {
    window: WINDOW,
    sessions,
    pricer: counterfactualPricer(),
    pricing: "as-of-use",
    cacheRules: () => ({ known: false, reason: "no rules in this test" }),
    ...overrides,
  };
}
