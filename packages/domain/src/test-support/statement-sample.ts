// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Statement } from "../statement.js";

// Phase 15 step 15.11: a sample draft statement for the domain, server and
// web tests (placeholder data only).
export function sampleStatement(overrides: Partial<Statement> = {}): Statement {
  return {
    version: 1,
    status: "draft",
    generatedAt: "2026-11-06T12:00:00.000Z",
    project: { id: "portal", name: "Customer portal", client: "ACME", billingCode: "AC-7" },
    period: { key: "2026-10", label: "October 2026", since: "2026-10-01", until: "2026-10-31", timeZone: "Europe/Tallinn" },
    includeSubscriptionUse: false,
    conversion: "1 AI Credit = $0.01 (GitHub's documented rate); no other exchange rate is used.",
    lines: [
      {
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
      },
    ],
    unknown: [{ reason: "Cannot price: unknown model", turns: 1, sessions: 1 }],
    excluded: [],
    markupPercent: 10,
    markup: [{ currency: "AI_CREDITS", base: 120, amount: 12 }],
    fixedLines: [{ label: "Seats", amount: 39, currency: "USD" }],
    totals: [
      { currency: "AI_CREDITS", lines: 120, markup: 12, fixed: 0, total: 132 },
      { currency: "USD", lines: 0, markup: 0, fixed: 39, total: 39 },
    ],
    userCurrency: { code: "EUR", perUsd: 0.9, total: 36.29, conversion: "1 USD = 0.9 EUR (the project's fixed rate); 1 AI Credit = $0.01." },
    coverage: { turns: 6, knownTurns: 5 },
    provenance: {
      appVersion: "0.9.0",
      priceBookHash: "pb1",
      projectsFileHash: "pf1",
      priceVersionIds: [],
      sessions: [
        { providerId: "vscode", sessionId: "s1", title: "Fix the bug" },
        { providerId: "vscode", sessionId: "s2", title: "Add a test" },
      ],
    },
    ...overrides,
  };
}
