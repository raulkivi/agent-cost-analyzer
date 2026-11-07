// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  channelCurrency,
  unknownCost,
  type CostFigure,
  type PriceBookEntry,
  type PriceLookup,
  type PricingMode,
  type TokenCount,
  type TurnUsage,
} from "@agent-cost-analyzer/domain";
import { pickTier, priceTurn } from "../learn-simulation/pricer.js";
import type { ChannelResolution } from "../cost-attribution/channel-resolver.js";
import type { PriceScope } from "./price-book.js";
import type { PriceModelMapper } from "./price-model-mapper.js";

// Phase 15 step 15.6 (docs/plans/cost-by-repository-and-project.md §5,
// §6.2): a turn's tokens × the price version in force on its channel → the
// `priced` CostFigure. Pure over two ports (DIP): a price lookup (PriceBook)
// and a model-id mapper. The arithmetic is Phase 13's priceTurn and pickTier,
// reused, not copied. Anything it can't price is unknown with the reason,
// never 0 (architecture.md constraint 6).

// The read slice of PriceBook the pricer needs.
export interface PriceLookupPort {
  priceFor(channel: string, modelId: string, at: string, scope?: PriceScope): PriceLookup;
  newestVersion(channel: string, modelId: string): PriceBookEntry | undefined;
}

// Which cache-write price applies to writes the log doesn't split by
// lifetime: the standard one (Anthropic's 5-minute, OpenAI's default) or
// the extended one (Anthropic's 1-hour). Chosen per provider.
export type CacheWriteLifetime = "standard" | "extended";

export interface PricingRequest {
  usage: TurnUsage;
  channel: ChannelResolution;
  // When the turn ran (§6.2); else the session's start, with a note.
  turnStartedAt?: string;
  sessionStartedAt?: string;
  // The turn's attribution (step 15.4), so a contract price applies in its scope.
  scope: PriceScope;
  defaultCacheWriteLifetime: CacheWriteLifetime;
  // Tokens a flat-fee plan may have covered: label the figure API-equivalent (§5).
  apiEquivalent: boolean;
  // When cache writes are unknown, uncached input already holds them (both
  // VS Code stores record input − cached), so a version that charges writes
  // as plain input can still price the turn exactly.
  uncachedIncludesUnknownCacheWrite: boolean;
}

export interface CostPricerDeps {
  prices: PriceLookupPort;
  models: PriceModelMapper;
  now?: () => Date;
}

const SESSION_START_NOTE = "Priced at the session's start: the turn records no time of its own.";
const TODAY_NOTE = "Priced at today's prices.";
const NO_TIME_REASON = "neither the turn nor its session records when it ran.";

const cannot = (reason: string): CostFigure => unknownCost(`Cannot price: ${reason}`);

type Lookup = { known: true; version: PriceBookEntry; notes: string[] } | { known: false; reason: string };

export class CostPricer {
  private readonly now: () => Date;

  constructor(private readonly deps: CostPricerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  price(request: PricingRequest, mode: PricingMode = "as-of-use"): CostFigure {
    if (!request.channel.known) return cannot(request.channel.reason);
    const channel = request.channel.channel;
    const model = this.deps.models.priceModelFor(channel, request.usage.model);
    if (!model.known) return cannot(model.reason);
    const lookup = this.lookup(request, channel, model.modelId, mode);
    if (!lookup.known) return cannot(lookup.reason);
    return priceWith(lookup.version, request, channel, lookup.notes);
  }

  private lookup(request: PricingRequest, channel: string, modelId: string, mode: PricingMode): Lookup {
    if (mode === "today") {
      const found = this.deps.prices.priceFor(channel, modelId, this.now().toISOString(), request.scope);
      const version = found.known ? found.version : this.deps.prices.newestVersion(channel, modelId);
      return version ? { known: true, version, notes: [TODAY_NOTE] } : { known: false, reason: found.known ? "" : found.reason };
    }
    const at = request.turnStartedAt ?? request.sessionStartedAt;
    if (at === undefined) return { known: false, reason: NO_TIME_REASON };
    const found = this.deps.prices.priceFor(channel, modelId, at, request.scope);
    if (!found.known) return found;
    return { known: true, version: found.version, notes: request.turnStartedAt === undefined ? [SESSION_START_NOTE] : [] };
  }
}

type Known = { known: true; value: number; estimated: boolean } | { known: false; reason: string };

function count(token: TokenCount, label: string): Known {
  return token.known
    ? { known: true, value: token.value, estimated: token.estimated === true }
    : { known: false, reason: `the ${label} token count is unknown (${token.reason})` };
}

function priceWith(version: PriceBookEntry, request: PricingRequest, channel: string, notes: string[]): CostFigure {
  const { usage } = request;
  const counts = [count(usage.uncachedInput, "uncached input"), count(usage.cacheRead, "cache-read"), count(usage.output, "output")];
  for (const c of counts) if (!c.known) return cannot(c.reason);
  const [uncached, cacheRead, output] = counts as Extract<Known, { known: true }>[];

  // Unknown writes are fine only where they're inside uncached input and
  // every tier charges them as plain input.
  const writesAsInput = version.tiers.every((tier) => tier.cacheWriteUsdPerM === null);
  const writes = count(usage.cacheWrite, "cache-write");
  if (!writes.known && !(request.uncachedIncludesUnknownCacheWrite && writesAsInput)) return cannot(writes.reason);
  const cacheWrite = writes.known ? writes.value : 0;

  const inputTokens = uncached!.value + cacheRead!.value + cacheWrite;
  const tier = pickTier(version.tiers, inputTokens);
  const rounds = usage.roundsCount;
  if (version.tiers.length > 1 && (rounds === undefined || rounds > 1) && tier !== version.tiers[0]) {
    return cannot(
      `the turn made ${rounds === undefined ? "several" : rounds} requests and the log gives only their sum, so which of ${version.id}'s prompt-length tiers each request used is unknown.`,
    );
  }

  const split = splitWrites(usage, cacheWrite, request.defaultCacheWriteLifetime);
  if (split.extended > 0 && tier.extendedCacheWriteUsdPerM === undefined && tier.cacheWriteUsdPerM !== null) {
    return cannot(`${version.id} has no extended (1-hour) cache-write price.`);
  }
  const cost = priceTurn(version, {
    uncachedInput: uncached!.value,
    cacheRead: cacheRead!.value,
    cacheWrite: cacheWrite - split.extended,
    extendedCacheWrite: split.extended,
    output: output!.value,
  });
  const currency = channelCurrency(channel);
  const estimated = [uncached!, cacheRead!, output!, writes].some((c) => c.known && c.estimated);
  const allNotes = [...notes, ...(split.note ? [split.note] : [])];
  return {
    known: true,
    amount: currency === "AI_CREDITS" ? cost.aiCredits : cost.usd,
    currency,
    basis: "priced",
    priceVersionIds: [version.id],
    ...(estimated ? { estimated: true } : {}),
    ...(request.apiEquivalent ? { apiEquivalent: true } : {}),
    ...(allNotes.length > 0 ? { notes: allNotes } : {}),
  };
}

// The extended-lifetime part of the writes: as recorded, else the
// provider's default, with a note saying which rate was assumed.
function splitWrites(usage: TurnUsage, cacheWrite: number, lifetime: CacheWriteLifetime): { extended: number; note?: string } {
  const recorded = usage.extendedCacheWrite;
  if (recorded?.known) return { extended: Math.min(recorded.value, cacheWrite) };
  if (cacheWrite === 0) return { extended: 0 };
  return lifetime === "extended"
    ? { extended: cacheWrite, note: "Cache writes priced at the extended (1-hour) cache-write rate, this provider's default; the log doesn't split them by lifetime." }
    : { extended: 0, note: "Cache writes priced at the standard cache-write rate, this provider's default; the log doesn't split them by lifetime." };
}
