// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  AI_CREDIT_CONVERSION_NOTE,
  costEstimateSchema,
  priceChangeListSchema,
  sessionReplayComparisonSchema,
  sessionReplaySchema,
  statementAnswerSchema,
} from "@agent-cost-analyzer/domain";
import type { CostEstimate, PriceChangeList, SessionReplay, SessionReplayComparison, Statement, StatementAnswer, StatementLine } from "@agent-cost-analyzer/domain";

// Fixtures for the Increment 3 view models (U12 to U15): invented figures,
// parsed with the domain schemas so they can't drift from what the tools send.

export const NOT_REPLAYED = "A request in this turn has no complete usage figures";

export function replay(overrides: Partial<SessionReplay> = {}): SessionReplay {
  return sessionReplaySchema.parse({
    simulated: true,
    sessionId: "s1",
    providerId: "claude-code",
    harness: "claude-code",
    measuredModels: ["claude-opus-5.5"],
    model: "claude-sonnet-5.5",
    vendorId: "anthropic",
    pricing: { channel: "api", asOf: "2026-10-21", requested: "session-channel" },
    currency: "USD",
    turns: [
      {
        turnIndex: 0,
        measured: { cacheRead: 30_000, cost: { known: true, value: 0.52, currency: "USD", basis: "priced" } },
        simulated: { cacheRead: 29_000, cacheWrite: 1_200, outcome: "partial", cost: { known: true, value: 0.31, currency: "USD" } },
      },
      {
        turnIndex: 1,
        measured: { cacheRead: null, cost: { known: false, reason: "A request in this turn has no cost figures" } },
        simulated: null,
        notReplayedReason: NOT_REPLAYED,
      },
      {
        turnIndex: 2,
        measured: { cacheRead: 31_000, cost: { known: true, value: 0.28, currency: "USD", basis: "priced" } },
        simulated: { cacheRead: 30_000, cacheWrite: 900, outcome: "hit", cost: { known: true, value: 0.17, currency: "USD" } },
      },
    ],
    totals: { measured: { value: 0.8, knownTurns: 2, turns: 3 }, simulated: { value: 0.48, knownTurns: 2, turns: 3 }, difference: -0.32 },
    coverage: { turns: 3, replayedTurns: 2, requests: 9, replayedRequests: 6, notReplayed: [{ reason: NOT_REPLAYED, turns: 1 }] },
    selfCheck: { model: "claude-opus-5.5", requests: 8, matching: 8, readTolerancePercent: 5, passed: true },
    assumptions: [{ id: "A1", text: "Same conversation: the other model gets the same prompts.", confidence: "unknown" }],
    ...overrides,
  });
}

export function replayComparison(overrides: Partial<SessionReplayComparison> = {}): SessionReplayComparison {
  return sessionReplayComparisonSchema.parse({
    simulated: true,
    sessionId: "s1",
    providerId: "claude-code",
    currency: "USD",
    measured: { value: 0.8, knownTurns: 2, turns: 3 },
    entries: [
      { model: "claude-opus-5.5", vendorId: "anthropic", total: { value: 0.8, knownTurns: 2, turns: 3 }, replayedTurns: 2, isMeasuredModel: true },
      { model: "claude-sonnet-5.5", vendorId: "anthropic", total: { value: 0.48, knownTurns: 2, turns: 3 }, replayedTurns: 2, isMeasuredModel: false },
      { model: "gpt-6.1-sol", vendorId: "openai", total: { value: null, knownTurns: 0, turns: 3 }, replayedTurns: 0, isMeasuredModel: false },
    ],
    ...overrides,
  });
}

export function priceChangeList(overrides: Partial<PriceChangeList> = {}): PriceChangeList {
  return priceChangeListSchema.parse({
    generatedAt: "2026-11-10T12:00:00Z",
    providers: [{ id: "copilot", label: "Copilot Chat", available: true, sessionCount: 12, truncated: false }],
    changes: [
      {
        kind: "documented",
        date: "2026-10-15",
        channel: "github-copilot",
        modelId: "gpt-5.5",
        fromVersionId: "v1",
        toVersionId: "v2",
        changes: [
          { tier: 0, tokenType: "input", fromUsdPerM: 2, toUsdPerM: 2.5, percent: 25 },
          { tier: 0, tokenType: "cacheWrite", fromUsdPerM: null, toUsdPerM: 3, percent: null },
          { tier: 0, tokenType: "output", fromUsdPerM: 10, toUsdPerM: 8, percent: -20 },
        ],
        sourceIds: ["src-copilot-models"],
        note: "Announced in the changelog",
      },
      {
        kind: "observed",
        date: "2026-10-20",
        channel: "github-copilot",
        modelId: "claude-sonnet-5.5",
        direction: "above",
        percent: 0.12,
        weeks: [
          { period: "2026-W43", start: "2026-10-20", end: "2026-10-26", turns: 40, billedAiCredits: 112, pricedAiCredits: 100, ratio: 1.12 },
          { period: "2026-W44", start: "2026-10-27", end: "2026-11-02", turns: 35, billedAiCredits: 56, pricedAiCredits: 50, ratio: 1.12 },
        ],
        priceVersionIds: ["v9"],
        confidence: "inferred",
      },
    ],
    ...overrides,
  });
}

function line(overrides: Partial<StatementLine>): StatementLine {
  return {
    key: "billed|AI_CREDITS|github-copilot|gpt-5.5|",
    basis: "billed",
    currency: "AI_CREDITS",
    channel: "github-copilot",
    model: "gpt-5.5",
    priceVersionId: null,
    sessions: 2,
    turns: 5,
    tokens: { uncachedInput: 1000, cacheRead: 3000, cacheWrite: 0, reasoning: null, output: 400 },
    unitPrices: null,
    amount: 120,
    apiEquivalent: false,
    ...overrides,
  };
}

export function statement(overrides: Partial<Statement> = {}): Statement {
  return {
    version: 1,
    status: "draft",
    generatedAt: "2026-11-06T12:00:00.000Z",
    project: { id: "portal", name: "Customer portal", client: "ACME", billingCode: "AC-7" },
    period: { key: "2026-10", label: "October 2026", since: "2026-10-01", until: "2026-10-31", timeZone: "Europe/Tallinn" },
    includeSubscriptionUse: false,
    conversion: AI_CREDIT_CONVERSION_NOTE,
    lines: [
      line({ key: "priced|USD|anthropic-api|claude-sonnet-5.5|v1", basis: "priced", currency: "USD", channel: "anthropic-api", model: "claude-sonnet-5.5", priceVersionId: "v1", amount: 4.5, turns: 3 }),
      line({}),
      line({ key: "billed|AI_CREDITS|null|o4|", channel: null, model: "o4", amount: 30, turns: 1, sessions: 1, tokens: { uncachedInput: null, cacheRead: null, cacheWrite: null, reasoning: null, output: null } }),
    ],
    unknown: [{ reason: "No cost figure in the log", turns: 1, sessions: 1 }],
    excluded: [{ reason: "Subscription use (API-equivalent)", turns: 2, sessions: 1 }],
    markup: [{ currency: "AI_CREDITS", base: 150, amount: 15 }],
    markupPercent: 10,
    fixedLines: [{ label: "Seats", amount: 39, currency: "USD" }],
    totals: [
      { currency: "USD", lines: 4.5, markup: 0, fixed: 39, total: 43.5 },
      { currency: "AI_CREDITS", lines: 150, markup: 15, fixed: 0, total: 165 },
    ],
    coverage: { turns: 10, knownTurns: 9 },
    provenance: { appVersion: "0.9.0", priceBookHash: "pb1", projectsFileHash: "pf1", priceVersionIds: ["v1"], sessions: [{ providerId: "vscode", sessionId: "s1" }] },
    ...overrides,
  };
}

export function statementAnswer(overrides: Partial<StatementAnswer> = {}): StatementAnswer {
  return statementAnswerSchema.parse({ statement: statement(), canIssue: { ok: true }, issuedPeriods: ["2026-09"], ...overrides });
}

export function issuedAnswerWithDiff(): StatementAnswer {
  const issued = statement({ status: "issued", issuedAt: "2026-11-02T09:00:00.000Z" });
  return statementAnswer({
    statement: issued,
    rerun: statement({ generatedAt: "2026-11-08T09:00:00.000Z" }),
    canIssue: { ok: false, reason: "The period is already issued" },
    diff: {
      changed: true,
      lines: [
        { key: "billed|AI_CREDITS|github-copilot|gpt-5.5|", change: "changed", issued: 120, current: 128, difference: 8 },
        { key: "priced|USD|anthropic-api|claude-haiku-5.5|v2", change: "added", issued: null, current: 1.25, difference: 1.25 },
        { key: "billed|AI_CREDITS|null|o4|", change: "removed", issued: 30, current: null, difference: -30 },
      ],
      totals: [
        { currency: "USD", issued: 43.5, current: 44.75, difference: 1.25 },
        { currency: "AI_CREDITS", issued: 165, current: 150.8, difference: -14.2 },
      ],
      unknownTurns: { issued: 1, current: 2 },
      sessions: { added: ["vscode:s3"], removed: [] },
      inputs: { priceBookChanged: true, projectsFileChanged: false },
    },
  });
}

export function estimate(overrides: Partial<CostEstimate> = {}): CostEstimate {
  return costEstimateSchema.parse({
    label: "estimate",
    generatedAt: "2026-11-10T12:00:00Z",
    target: { groupBy: "project", id: "portal", name: "Customer portal" },
    pricing: "today",
    currency: "USD",
    conversion: AI_CREDIT_CONVERSION_NOTE,
    window: { weeks: 12, since: "2026-08-17", until: "2026-11-09" },
    unit: "activeDays",
    planned: 10,
    history: { units: 24, knownUnits: 20, turns: 800, totalUsd: 310.4 },
    runRate: { perActiveDayUsd: 12.9, perWeekUsd: 25.87 },
    unitCost: { p50: 9.5, p90: 21 },
    range: { p50: 95, p90: 210 },
    ...overrides,
  });
}

export function refusedEstimate(overrides: Partial<CostEstimate> = {}): CostEstimate {
  return estimate({
    history: { units: 3, knownUnits: 2, turns: 30, totalUsd: 20 },
    runRate: { perActiveDayUsd: null, perWeekUsd: 1.67 },
    unitCost: null,
    range: null,
    refusal: "Only 2 days have every turn priced; at least 5 are needed",
    ...overrides,
  });
}

export function simulatedEstimate(): CostEstimate {
  return estimate({
    pricing: "as-of-use",
    simulation: {
      label: "simulated",
      model: "claude-sonnet-5.5",
      vendorId: "anthropic",
      method: "Each session in the window replayed on the model",
      sessions: 24,
      replayedSessions: 20,
      turns: 800,
      replayedTurns: 700,
      notReplayed: [{ reason: NOT_REPLAYED, turns: 100 }],
      selfCheck: { checked: 18, passed: 17 },
      assumptions: [{ id: "A1", text: "Same conversation.", confidence: "unknown" }],
    },
  });
}
