// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency, PricingMode, TokenCount, TurnUsage } from "@agent-cost-analyzer/domain";
import type { ChannelResolution } from "../cost-attribution/channel-resolver.js";
import type { CacheWriteLifetime, CostPricer } from "../pricing/cost-pricer.js";
import type { PriceScope } from "../pricing/price-book.js";

// Phase 16 SR3 (docs/plans/savings-report.md §5.2): prices N tokens as one
// token type versus another for a model, channel and date, through
// CostPricer (one price lookup, one arithmetic, no copy of either). A
// counterfactual cannot be billed, so the result is a range of USD or AI
// Credits, or unknown with the pricer's reason, never 0 (constraint 6).

export type TokenKind = "uncachedInput" | "cacheRead" | "cacheWrite" | "output";

export interface CounterfactualQuery {
  model: string;
  channel: ChannelResolution;
  // When the tokens were sent; absent: as-of-use mode cannot price them.
  at?: string;
  scope?: PriceScope;
  tokens: number;
  // What the tokens were billed as. Several kinds make a range: the log
  // doesn't say which (e.g. cache writes unknown: a write or plain input).
  billedAs: TokenKind | readonly TokenKind[];
  // What they would be billed as instead, or "nothing" when they would not be sent.
  instead: TokenKind | "nothing";
  // Which cache-write price a write kind takes (Anthropic: 5-minute or 1-hour).
  cacheWriteLifetime?: CacheWriteLifetime;
}

export type CounterfactualSaving =
  | { known: true; currency: Currency; low: number; high: number; priceVersionIds: string[] }
  | { known: false; reason: string };

type KindCost = { known: true; amount: number; currency: Currency; versions: string[] } | { known: false; reason: string };

const known = (value: number): TokenCount => ({ known: true, value });
const NOT_APPLICABLE: TokenCount = { known: false, reason: "not part of a counterfactual price" };

// The synthetic usage: every token in one kind, the rest 0, one request (so
// a tiered price is picked by this prompt length alone).
function usageOf(model: string, kind: TokenKind, tokens: number): TurnUsage {
  return {
    uncachedInput: known(kind === "uncachedInput" ? tokens : 0),
    cacheRead: known(kind === "cacheRead" ? tokens : 0),
    cacheWrite: known(kind === "cacheWrite" ? tokens : 0),
    output: known(kind === "output" ? tokens : 0),
    tool: NOT_APPLICABLE,
    vision: NOT_APPLICABLE,
    reasoning: NOT_APPLICABLE,
    costAiCredits: NOT_APPLICABLE,
    model,
    roundsCount: 1,
  };
}

export class CounterfactualPricer {
  constructor(private readonly costs: CostPricer) {}

  saving(query: CounterfactualQuery, mode: PricingMode = "as-of-use"): CounterfactualSaving {
    const billedKinds: readonly TokenKind[] = Array.isArray(query.billedAs) ? query.billedAs : [query.billedAs as TokenKind];
    const billed = billedKinds.map((kind) => this.cost(query, kind, mode));
    const instead = query.instead === "nothing" ? undefined : this.cost(query, query.instead, mode);
    const figures = instead ? [...billed, instead] : billed;
    const unknown = figures.find((figure) => !figure.known);
    if (unknown && !unknown.known) return { known: false, reason: unknown.reason };

    const priced = billed.filter((figure) => figure.known);
    const amounts = priced.map((figure) => figure.amount);
    const insteadAmount = instead?.known ? instead.amount : 0;
    return {
      known: true,
      currency: priced[0].currency,
      // No saving is claimed where the other type would cost more.
      low: Math.max(0, Math.min(...amounts) - insteadAmount),
      high: Math.max(0, Math.max(...amounts) - insteadAmount),
      priceVersionIds: [...new Set(figures.flatMap((figure) => (figure.known ? figure.versions : [])))].sort(),
    };
  }

  private cost(query: CounterfactualQuery, kind: TokenKind, mode: PricingMode): KindCost {
    const figure = this.costs.price(
      {
        usage: usageOf(query.model, kind, query.tokens),
        channel: query.channel,
        ...(query.at === undefined ? {} : { turnStartedAt: query.at }),
        scope: query.scope ?? {},
        defaultCacheWriteLifetime: query.cacheWriteLifetime ?? "standard",
        apiEquivalent: false,
        uncachedIncludesUnknownCacheWrite: false,
      },
      mode,
    );
    return figure.known
      ? { known: true, amount: figure.amount, currency: figure.currency, versions: figure.priceVersionIds ?? [] }
      : { known: false, reason: figure.reason };
  }
}
