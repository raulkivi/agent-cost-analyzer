import {
  CHANNEL,
  USD_PER_AI_CREDIT,
  vendorApiChannel,
  type Currency,
  type ReplayPriceChannel,
  type ReplayPricing,
  type SimulatedCost,
  type TurnUsage,
} from "@agent-cost-analyzer/domain";
import type { ChannelResolution } from "../cost-attribution/channel-resolver.js";
import type { PricingRequest } from "../pricing/cost-pricer.js";
import {
  pricingPolicyFor,
  type PricedFigureSource,
} from "../pricing/turn-cost-figures.js";

// Phase 14 step 14.4 (docs/plans/analyze-session-replay.md §7, D2): a
// simulated request priced on the replay's channel, as of the session's
// date, through Phase 15's CostPricer (a port, DIP) over the price book.
// Anything it can't price is unknown with the reason, never 0
// (constraint 6).

export type ReplayChannelResolution =
  | { known: true; channel: string; kind: ReplayPriceChannel }
  | { known: false; reason: string };

const COPILOT: ReplayChannelResolution = {
  known: true,
  channel: CHANNEL.githubCopilot,
  kind: "copilot",
};

function vendorApi(targetVendorId: string): ReplayChannelResolution {
  const channel = vendorApiChannel(targetVendorId);
  return channel
    ? { known: true, channel, kind: "api" }
    : {
        known: false,
        reason: `No API channel is listed for the vendor ${JSON.stringify(targetVendorId)}, so the replay can't be priced at its API price.`,
      };
}

// D2: the session's own channel by default, or the one asked for. A
// Copilot session stays on Copilot's price table; any other session (an
// API channel, Bedrock, a contract) is priced at the replay vendor's own API
// price, since the other model isn't sold on the session's channel (a Claude
// Code session replayed on GPT is priced at OpenAI's API price).
export function replayChannel(
  requested: ReplayPricing["requested"],
  sessionChannel: ChannelResolution,
  targetVendorId: string,
): ReplayChannelResolution {
  if (requested === "copilot") return COPILOT;
  if (requested === "api") return vendorApi(targetVendorId);
  if (!sessionChannel.known) {
    return { known: false, reason: sessionChannel.reason };
  }
  return sessionChannel.channel === CHANNEL.githubCopilot
    ? COPILOT
    : vendorApi(targetVendorId);
}

export interface ReplayPriceRequest {
  // A simulated request's usage; usage.model is the profile model id.
  usage: TurnUsage;
  // From replayChannel.
  channel: string;
  // When the request ran (the session's date): as-of-use pricing.
  at: string;
  // The replayed session's provider, for its pricing policy.
  providerId: string;
}

export class ReplayPricer {
  constructor(private readonly pricer: PricedFigureSource) {}

  price(request: ReplayPriceRequest): SimulatedCost {
    const pricing: PricingRequest = {
      usage: request.usage,
      channel: { known: true, channel: request.channel },
      turnStartedAt: request.at,
      // No scope: a contract price is agreed for a repository or project's
      // real use; a hypothetical run on another model is priced at list.
      scope: {},
      // The provider's cache-write lifetime for writes not split by
      // lifetime (Claude Code's 1-hour default); a split the simulator
      // records in usage.extendedCacheWrite always wins.
      ...pricingPolicyFor(request.providerId),
      // apiEquivalent only labels a figure a flat-fee plan may have
      // covered; it never changes the amount. A replay is hypothetical and
      // labelled simulated as a whole, and SimulatedCost carries no labels.
      apiEquivalent: false,
    };
    const figure = this.pricer.price(pricing, "as-of-use");
    return figure.known
      ? { known: true, value: figure.amount, currency: figure.currency }
      : { known: false, reason: figure.reason };
  }
}

// The one documented conversion, 1 AI Credit = $0.01 (GitHub's rate), so a
// measured cost can be shown in the replay's currency. No other exchange
// rate is used: any other pair is undefined.
export function convertCost(
  value: number,
  from: Currency,
  to: Currency,
): number | undefined {
  if (from === to) return value;
  if (from === "AI_CREDITS" && to === "USD") return value * USD_PER_AI_CREDIT;
  if (from === "USD" && to === "AI_CREDITS") return value / USD_PER_AI_CREDIT;
  return undefined;
}
