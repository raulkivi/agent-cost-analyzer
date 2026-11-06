import { describe, expect, it } from "vitest";
import type { PriceBookEntry, PriceLookup, PriceTier, TokenCount, TurnUsage } from "@agent-cost-analyzer/domain";
import { CostPricer, type PriceLookupPort, type PricingRequest } from "./cost-pricer.js";
import type { PriceModelMapper } from "./price-model-mapper.js";
import type { PriceScope } from "./price-book.js";

// Step 15.6 (plan §5, §6.2, §12.1): tokens × the price version in force.
// The pricer is tested with fakes for its two ports (DIP).

const tier: PriceTier = { inputUsdPerM: 2, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: 2.5, extendedCacheWriteUsdPerM: 4, outputUsdPerM: 10 };

function version(overrides: Partial<PriceBookEntry> = {}): PriceBookEntry {
  return {
    id: "anthropic-api:claude-sonnet-5.5:2026-10-01",
    channel: "anthropic-api",
    modelId: "claude-sonnet-5.5",
    currency: "USD",
    effectiveFrom: "2026-10-01",
    tiers: [tier],
    kind: "list",
    sourceIds: ["s"],
    origin: "bundled",
    ...overrides,
  };
}

// Sonnet 5.5 on two channels, with a cache-read price cut on 2026-10-07.
const BEFORE_CUT = version({ effectiveTo: "2026-10-07" });
const AFTER_CUT = version({ id: "anthropic-api:claude-sonnet-5.5:2026-10-07", effectiveFrom: "2026-10-07", tiers: [{ ...tier, cachedInputUsdPerM: 0.1 }] });
const COPILOT = version({ id: "github-copilot:claude-sonnet-5.5:2026-10-01", channel: "github-copilot" });

class FakePrices implements PriceLookupPort {
  calls: { channel: string; modelId: string; at: string; scope?: PriceScope }[] = [];
  constructor(private readonly versions: PriceBookEntry[]) {}

  priceFor(channel: string, modelId: string, at: string, scope?: PriceScope): PriceLookup {
    this.calls.push({ channel, modelId, at, ...(scope ? { scope } : {}) });
    const time = Date.parse(at.length === 10 ? `${at}T00:00:00Z` : at);
    const match = this.versions.find(
      (v) =>
        v.channel === channel &&
        v.modelId === modelId &&
        (v.kind !== "contract" || (v.scope && "projectId" in v.scope && v.scope.projectId === scope?.projectId)) &&
        Date.parse(`${v.effectiveFrom}T00:00:00Z`) <= time &&
        (v.effectiveTo === undefined || time < Date.parse(`${v.effectiveTo}T00:00:00Z`)),
    );
    const contract = this.versions.find((v) => v.kind === "contract" && match && v.modelId === modelId && v.channel === channel && v.scope && "projectId" in v.scope && v.scope.projectId === scope?.projectId);
    const found = contract ?? match;
    return found ? { known: true, version: found } : { known: false, reason: `no price for ${modelId} on ${channel} at ${at}` };
  }

  newestVersion(channel: string, modelId: string): PriceBookEntry | undefined {
    return this.versions.filter((v) => v.channel === channel && v.modelId === modelId && v.kind !== "contract").at(-1);
  }
}

const identityMapper: PriceModelMapper = {
  priceModelFor: (_channel, model) =>
    model === "mystery-model" ? { known: false, reason: "The price book has no model matching \"mystery-model\"." } : { known: true, modelId: model.replace("claude-sonnet-5-5", "claude-sonnet-5.5") },
};

const k = (value: number, estimated = false): TokenCount => (estimated ? { known: true, value, estimated } : { known: true, value });
const u = (reason: string): TokenCount => ({ known: false, reason });

function usage(overrides: Partial<TurnUsage> = {}): TurnUsage {
  return {
    uncachedInput: k(1_000_000),
    cacheWrite: k(0),
    cacheRead: k(0),
    tool: u("n/a"),
    vision: u("n/a"),
    reasoning: u("not recorded"),
    output: k(0),
    costAiCredits: u("not Copilot"),
    model: "claude-sonnet-5.5",
    roundsCount: 1,
    ...overrides,
  };
}

function request(overrides: Partial<PricingRequest> = {}): PricingRequest {
  return {
    usage: usage(),
    channel: { known: true, channel: "anthropic-api" },
    turnStartedAt: "2026-10-08T12:00:00Z",
    scope: {},
    defaultCacheWriteLifetime: "standard",
    apiEquivalent: false,
    uncachedIncludesUnknownCacheWrite: false,
    ...overrides,
  };
}

const NOW = new Date("2026-11-06T10:00:00Z");
function pricer(versions: PriceBookEntry[] = [BEFORE_CUT, AFTER_CUT, COPILOT]) {
  const prices = new FakePrices(versions);
  return { prices, pricer: new CostPricer({ prices, models: identityMapper, now: () => NOW }) };
}

describe("CostPricer: tokens × the version in force", () => {
  it("prices each token kind at its own rate, in USD on an API channel, naming the version", () => {
    const figure = pricer().pricer.price(
      request({
        usage: usage({ uncachedInput: k(1_000_000), cacheRead: k(1_000_000), cacheWrite: k(1_000_000), extendedCacheWrite: k(0), output: k(1_000_000) }),
      }),
    );
    expect(figure).toEqual({
      known: true,
      amount: 2 + 0.1 + 2.5 + 10,
      currency: "USD",
      basis: "priced",
      priceVersionIds: ["anthropic-api:claude-sonnet-5.5:2026-10-07"],
      byTokenType: { uncachedInput: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
    });
  });

  // Step 15.10 (plan §8.4): the cost per token type, so the variance can
  // find each cell's unit price. It sums to the amount, in its currency.
  it("splits the amount by token type, in the figure's currency, counting both write lifetimes as cache write", () => {
    const figure = pricer().pricer.price(
      request({
        channel: { known: true, channel: "github-copilot" },
        usage: usage({ uncachedInput: k(1_000_000), cacheRead: k(1_000_000), cacheWrite: k(1_000_000), extendedCacheWrite: k(500_000), output: k(1_000_000) }),
      }),
    );
    expect(figure).toMatchObject({ known: true, currency: "AI_CREDITS", byTokenType: { uncachedInput: 200, cacheRead: 20, cacheWrite: 125 + 200, output: 1000 } });
    if (figure.known) {
      const parts = figure.byTokenType!;
      expect(parts.uncachedInput + parts.cacheRead + parts.cacheWrite + parts.output).toBeCloseTo(figure.amount, 9);
    }
  });

  it("charges writes without a write price as uncached input... but books them as cache write", () => {
    const noWritePrice = version({ id: "v-auto", tiers: [{ ...tier, cacheWriteUsdPerM: null, extendedCacheWriteUsdPerM: undefined }] });
    const figure = pricer([noWritePrice]).pricer.price(request({ usage: usage({ uncachedInput: k(0), cacheWrite: k(1_000_000) }) }));
    expect(figure).toMatchObject({ amount: 2, byTokenType: { uncachedInput: 0, cacheRead: 0, cacheWrite: 2, output: 0 } });
  });

  it("gives AI Credits on GitHub Copilot, at 1 AI Credit = $0.01", () => {
    const figure = pricer().pricer.price(request({ channel: { known: true, channel: "github-copilot" } }));
    expect(figure).toMatchObject({ known: true, amount: 200, currency: "AI_CREDITS", priceVersionIds: [COPILOT.id] });
  });

  it("prices a turn by its own timestamp, on either side of a price change", () => {
    const { pricer: p } = pricer();
    const reads = usage({ uncachedInput: k(0), cacheRead: k(1_000_000) });
    expect(p.price(request({ usage: reads, turnStartedAt: "2026-10-06T23:59:59Z" }))).toMatchObject({ amount: 0.2, priceVersionIds: [BEFORE_CUT.id] });
    expect(p.price(request({ usage: reads, turnStartedAt: "2026-10-07T00:00:00Z" }))).toMatchObject({ amount: 0.1, priceVersionIds: [AFTER_CUT.id] });
  });

  it("falls back to the session start when the turn records no time, and says so", () => {
    const figure = pricer().pricer.price(request({ turnStartedAt: undefined, sessionStartedAt: "2026-10-02T08:00:00Z" }));
    expect(figure).toMatchObject({ known: true, priceVersionIds: [BEFORE_CUT.id] });
    expect(figure.known && figure.notes).toEqual(["Priced at the session's start: the turn records no time of its own."]);
  });

  it("passes the turn's project and repository to the lookup, so a contract price applies in its scope", () => {
    const contract = version({ id: "user:sonnet:acme", kind: "contract", scope: { projectId: "acme" }, origin: "user", tiers: [{ ...tier, inputUsdPerM: 1 }] });
    const { prices, pricer: p } = pricer([AFTER_CUT, contract]);
    const scope = { projectId: "acme", repositoryKey: "github.com/acme/app" };
    expect(p.price(request({ scope }))).toMatchObject({ amount: 1, priceVersionIds: ["user:sonnet:acme"] });
    expect(prices.calls.at(-1)).toEqual({ channel: "anthropic-api", modelId: "claude-sonnet-5.5", at: "2026-10-08T12:00:00Z", scope });
  });

  it("maps the provider's model id to the price book's", () => {
    expect(pricer().pricer.price(request({ usage: usage({ model: "claude-sonnet-5-5" }) }))).toMatchObject({ known: true });
  });

  it("marks an estimated token count, and an API-equivalent (subscription) figure", () => {
    const figure = pricer().pricer.price(request({ usage: usage({ uncachedInput: k(10, true) }), apiEquivalent: true }));
    expect(figure).toMatchObject({ known: true, estimated: true, apiEquivalent: true });
  });
});

describe("CostPricer: per-request tiers (as Phase 13's Pricer)", () => {
  const tiered = version({
    id: "anthropic-api:claude-sonnet-5.5:tiered",
    effectiveFrom: "2026-10-01",
    tiers: [
      { ...tier, maxInputTokens: 200_000 },
      { inputUsdPerM: 4, cachedInputUsdPerM: 0.4, cacheWriteUsdPerM: 5, extendedCacheWriteUsdPerM: 8, outputUsdPerM: 20 },
    ],
  });

  it("uses the long-context tier once one request's input is over the threshold", () => {
    const { pricer: p } = pricer([tiered]);
    expect(p.price(request({ usage: usage({ uncachedInput: k(200_000) }) }))).toMatchObject({ amount: 0.4 });
    expect(p.price(request({ usage: usage({ uncachedInput: k(250_000) }) }))).toMatchObject({ amount: 1 });
  });

  it("prices a several-request turn whose whole input stays in the first tier", () => {
    const { pricer: p } = pricer([tiered]);
    expect(p.price(request({ usage: usage({ uncachedInput: k(150_000), roundsCount: 3 }) }))).toMatchObject({ known: true, amount: 0.3 });
  });

  it("is unknown when a several-request turn crosses a tier threshold, since the log gives only the turn's sum", () => {
    const figure = pricer([tiered]).pricer.price(request({ usage: usage({ uncachedInput: k(300_000), roundsCount: 3 }) }));
    expect(figure.known).toBe(false);
    if (!figure.known) expect(figure.reason).toMatch(/3 requests/);
  });
});

describe("CostPricer: cache-write lifetime", () => {
  const writes = (extended?: TokenCount) => usage({ uncachedInput: k(0), cacheWrite: k(1_000_000), ...(extended ? { extendedCacheWrite: extended } : {}) });

  it("prices the recorded 1-hour subset at the extended rate and the rest at the standard rate", () => {
    expect(pricer().pricer.price(request({ usage: writes(k(250_000)) }))).toMatchObject({ amount: 0.75 * 2.5 + 0.25 * 4 });
  });

  it("applies the provider's default lifetime when the log doesn't split the writes, and says so", () => {
    const { pricer: p } = pricer();
    const extended = p.price(request({ usage: writes(), defaultCacheWriteLifetime: "extended" }));
    expect(extended).toMatchObject({ amount: 4 });
    expect(extended.known && extended.notes?.[0]).toMatch(/extended \(1-hour\) cache-write rate/);
    const standard = p.price(request({ usage: writes(u("not split")), defaultCacheWriteLifetime: "standard" }));
    expect(standard).toMatchObject({ amount: 2.5 });
    expect(standard.known && standard.notes?.[0]).toMatch(/standard cache-write rate/);
  });

  it("is unknown when there are 1-hour writes but the version has no 1-hour price", () => {
    const noExtended = version({ id: "v-fast", tiers: [{ ...tier, extendedCacheWriteUsdPerM: undefined }] });
    const figure = pricer([noExtended]).pricer.price(request({ usage: writes(k(10)) }));
    expect(figure).toEqual({ known: false, reason: "Cannot price: v-fast has no extended (1-hour) cache-write price." });
  });

  it("charges writes as plain input where the vendor has no cache-write price", () => {
    const noWritePrice = version({ id: "v-auto", tiers: [{ ...tier, cacheWriteUsdPerM: null, extendedCacheWriteUsdPerM: undefined }] });
    expect(pricer([noWritePrice]).pricer.price(request({ usage: writes() }))).toMatchObject({ amount: 2 });
  });
});

describe("CostPricer: unknown is never 0 (constraint 6)", () => {
  const unknownReason = (figure: ReturnType<CostPricer["price"]>) => (figure.known ? "known" : figure.reason);

  it("is unknown when a token count is unknown", () => {
    const figure = pricer().pricer.price(request({ usage: usage({ output: u("Output not recorded.") }) }));
    expect(unknownReason(figure)).toBe("Cannot price: the output token count is unknown (Output not recorded.)");
  });

  it("is unknown when cache writes are unknown and the version prices them apart", () => {
    const figure = pricer().pricer.price(request({ usage: usage({ cacheWrite: u("no trace db") }), uncachedIncludesUnknownCacheWrite: true }));
    expect(unknownReason(figure)).toBe("Cannot price: the cache-write token count is unknown (no trace db)");
  });

  it("prices unknown cache writes inside uncached input when the vendor charges writes as input", () => {
    const noWritePrice = version({ id: "v-auto", channel: "github-copilot", tiers: [{ ...tier, cacheWriteUsdPerM: null, extendedCacheWriteUsdPerM: undefined }] });
    const figure = pricer([noWritePrice]).pricer.price(
      request({ channel: { known: true, channel: "github-copilot" }, usage: usage({ cacheWrite: u("no trace db") }), uncachedIncludesUnknownCacheWrite: true }),
    );
    expect(figure).toMatchObject({ known: true, amount: 200 });
  });

  it("is unknown with the lookup's reason when no version is in force", () => {
    const figure = pricer().pricer.price(request({ turnStartedAt: "2026-09-30T12:00:00Z" }));
    expect(unknownReason(figure)).toBe("Cannot price: no price for claude-sonnet-5.5 on anthropic-api at 2026-09-30T12:00:00Z");
  });

  it("is unknown for an unmappable model, an unknown channel and no time at all", () => {
    const { pricer: p } = pricer();
    expect(unknownReason(p.price(request({ usage: usage({ model: "mystery-model" }) })))).toBe(
      'Cannot price: The price book has no model matching "mystery-model".',
    );
    expect(unknownReason(p.price(request({ channel: { known: false, reason: "No channel is known." } })))).toBe("Cannot price: No channel is known.");
    expect(unknownReason(p.price(request({ turnStartedAt: undefined })))).toBe(
      "Cannot price: neither the turn nor its session records when it ran.",
    );
  });
});

describe("CostPricer: at today's prices (plan §6.2)", () => {
  it("prices every turn at the version in force now, whatever its own time", () => {
    const { prices, pricer: p } = pricer();
    const reads = usage({ uncachedInput: k(0), cacheRead: k(1_000_000) });
    const figure = p.price(request({ usage: reads, turnStartedAt: "2026-10-02T00:00:00Z" }), "today");
    expect(figure).toMatchObject({ amount: 0.1, priceVersionIds: [AFTER_CUT.id] });
    expect(prices.calls.at(-1)?.at).toBe(NOW.toISOString());
    expect(figure.known && figure.notes).toEqual(["Priced at today's prices."]);
  });

  it("uses the newest version when none is in force now (a model since withdrawn)", () => {
    const withdrawn = version({ effectiveTo: "2026-10-19" });
    const figure = pricer([withdrawn]).pricer.price(request(), "today");
    expect(figure).toMatchObject({ known: true, priceVersionIds: [withdrawn.id] });
  });

  it("needs no turn time", () => {
    expect(pricer().pricer.price(request({ turnStartedAt: undefined }), "today").known).toBe(true);
  });
});
