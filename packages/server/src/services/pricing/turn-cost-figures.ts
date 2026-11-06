import { unknownCost, type CostFigure, type PricingMode, type Session, type Turn, type TurnCostFigures, type TurnUsage } from "@agent-cost-analyzer/domain";
import type { Attribution } from "../cost-attribution/session-attributor.js";
import type { CacheWriteLifetime, PricingRequest } from "./cost-pricer.js";
import type { PriceScope } from "./price-book.js";

// Phase 15 step 15.6 (docs/plans/cost-by-repository-and-project.md §5): a
// turn's billed, reported and priced figures. Billed and reported come from
// what the log recorded; priced from the CostPricer. Each is unknown with a
// reason when it can't be had, never 0 (constraint 6).

// What GitHub billed: Copilot's copilotUsageNanoAiu, already AI Credits in
// TurnUsage.costAiCredits (only Copilot providers record it as known).
export function billedFigure(usage: TurnUsage): CostFigure {
  const credits = usage.costAiCredits;
  if (!credits.known) return unknownCost(credits.reason);
  return { known: true, amount: credits.value, currency: "AI_CREDITS", basis: "billed", ...(credits.estimated ? { estimated: true } : {}) };
}

const NO_REPORTED_COST_REASON = "This provider logs no cost of its own.";

// What the agent priced itself: pi's Usage.cost.total, USD.
export function reportedFigure(usage: TurnUsage): CostFigure {
  const cost = usage.reportedCostUsd;
  if (cost === undefined) return unknownCost(NO_REPORTED_COST_REASON);
  if (!cost.known) return unknownCost(cost.reason);
  return { known: true, amount: cost.value, currency: "USD", basis: "reported" };
}

export type ProviderPricingPolicy = Pick<PricingRequest, "defaultCacheWriteLifetime" | "apiEquivalent" | "uncachedIncludesUnknownCacheWrite">;

const standard = (overrides: Partial<ProviderPricingPolicy> = {}): ProviderPricingPolicy => ({
  defaultCacheWriteLifetime: "standard" as CacheWriteLifetime,
  apiEquivalent: false,
  uncachedIncludesUnknownCacheWrite: false,
  ...overrides,
});

// Per provider (step 15.6 notes in plan §14.1):
// - Claude Code writes its cache with the 1-hour lifetime (calibration,
//   docs/plans/learn-calibration-findings.md, finding 1; #145), so writes its
//   log doesn't split are priced at the 1-hour rate; its use may be under a
//   subscription, so its priced figures are API-equivalent (§5, D4).
// - Copilot keeps the 5-minute (standard) rate, as the calibration decided;
//   both VS Code stores record uncached input as input − cached, so unknown
//   cache writes are inside it.
// - pi and mitmproxy call the vendor's API with its default lifetime.
const POLICIES: Readonly<Record<string, ProviderPricingPolicy>> = {
  "claude-code": standard({ defaultCacheWriteLifetime: "extended", apiEquivalent: true }),
  vscode: standard({ uncachedIncludesUnknownCacheWrite: true }),
};

export function pricingPolicyFor(providerId: string): ProviderPricingPolicy {
  return Object.hasOwn(POLICIES, providerId) ? POLICIES[providerId]! : standard();
}

// The pricer's one method this needs (CostPricer satisfies it).
export interface PricedFigureSource {
  price(request: PricingRequest, mode?: PricingMode): CostFigure;
}

// The port the dataset and cost builders use (DIP).
export interface TurnPricer {
  figuresFor(providerId: string, session: Session, turn: Turn, attribution: Attribution): TurnCostFigures;
}

// What long-lived services hold: a pricer over the price book as it is when
// a dataset (or one session) is priced, so the book is read once per use.
// Step 15.7: in the pricing mode the view asks for (§6.2; as of use by default).
export interface TurnPricing {
  snapshot(mode?: PricingMode): TurnPricer;
}

const NO_PRICE_BOOK_REASON = "No price book is configured for this product, so no turn is priced.";

export function scopeOf(attribution: Attribution): PriceScope {
  if (!attribution.repository.attributed) return {};
  return {
    ...(attribution.projectId !== null ? { projectId: attribution.projectId } : {}),
    repositoryKey: attribution.repository.repository.key,
  };
}

export class TurnCostFigureBuilder implements TurnPricer, TurnPricing {
  constructor(
    private readonly pricer?: PricedFigureSource,
    private readonly mode: PricingMode = "as-of-use",
  ) {}

  // Its pricer is fixed already; another mode prices over the same pricer.
  snapshot(mode: PricingMode = this.mode): TurnPricer {
    return mode === this.mode ? this : new TurnCostFigureBuilder(this.pricer, mode);
  }

  figuresFor(providerId: string, session: Session, turn: Turn, attribution: Attribution): TurnCostFigures {
    return {
      billed: billedFigure(turn.usage),
      reported: reportedFigure(turn.usage),
      priced: this.pricer
        ? this.pricer.price(
            {
              usage: turn.usage,
              channel: attribution.channel,
              ...(turn.startedAt !== undefined ? { turnStartedAt: turn.startedAt } : {}),
              ...(session.startedAt !== undefined ? { sessionStartedAt: session.startedAt } : {}),
              scope: scopeOf(attribution),
              ...pricingPolicyFor(providerId),
            },
            this.mode,
          )
        : unknownCost(NO_PRICE_BOOK_REASON),
    };
  }
}
