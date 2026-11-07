import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CHANNEL,
  type TokenCount,
  type TurnUsage,
} from "@agent-cost-analyzer/domain";
import { BundledPriceBookSource } from "../pricing/bundled-price-book-source.js";
import { CostPricer, type PricingRequest } from "../pricing/cost-pricer.js";
import { PriceBook } from "../pricing/price-book.js";
import { CandidatePriceModelMapper } from "../pricing/price-model-mapper.js";
import {
  convertCost,
  ReplayPricer,
  replayChannel,
  type ReplayPriceRequest,
} from "./replay-pricer.js";

// Step 14.4 (docs/plans/analyze-session-replay.md §7, D2): a simulated
// request priced on the replay's channel as of the session's date, over the
// real bundled price book.

const book = new PriceBook(new BundledPriceBookSource()).snapshot();
const costPricer = new CostPricer({
  prices: book,
  models: new CandidatePriceModelMapper(book),
});
const pricer = new ReplayPricer(costPricer);

const k = (value: number): TokenCount => ({ known: true, value });
const na = (reason: string): TokenCount => ({ known: false, reason });

function usage(overrides: Partial<TurnUsage> = {}): TurnUsage {
  return {
    uncachedInput: k(0),
    cacheWrite: k(0),
    cacheRead: k(0),
    tool: k(0),
    vision: k(0),
    reasoning: k(0),
    output: k(0),
    costAiCredits: k(0),
    model: "claude-opus-5.5",
    roundsCount: 1,
    ...overrides,
  };
}

function request(
  overrides: Partial<ReplayPriceRequest> = {},
): ReplayPriceRequest {
  return {
    usage: usage({ uncachedInput: k(1_000_000) }),
    channel: CHANNEL.anthropicApi,
    at: "2026-10-10T12:00:00Z",
    providerId: "claude-code",
    ...overrides,
  };
}

describe("replayChannel (D2)", () => {
  const copilot = { known: true as const, channel: CHANNEL.githubCopilot };
  const anthropicApi = { known: true as const, channel: CHANNEL.anthropicApi };

  it("prices on GitHub Copilot when asked, whatever the session used", () => {
    expect(replayChannel("copilot", anthropicApi, "openai")).toEqual({
      known: true,
      channel: CHANNEL.githubCopilot,
      kind: "copilot",
    });
  });

  it("prices on the replay model's vendor API when asked", () => {
    expect(replayChannel("api", copilot, "openai")).toEqual({
      known: true,
      channel: CHANNEL.openaiApi,
      kind: "api",
    });
  });

  it("is unknown when the target vendor has no API channel", () => {
    const resolved = replayChannel("api", copilot, "microsoft");
    expect(resolved.known).toBe(false);
    if (!resolved.known) expect(resolved.reason).toContain('"microsoft"');
  });

  it("keeps a Copilot session on Copilot by default", () => {
    expect(replayChannel("session-channel", copilot, "openai")).toEqual({
      known: true,
      channel: CHANNEL.githubCopilot,
      kind: "copilot",
    });
  });

  it("prices an API (or other) session at the replay vendor's API price by default", () => {
    // A Claude Code session replayed on GPT: OpenAI's API price.
    expect(replayChannel("session-channel", anthropicApi, "openai")).toEqual({
      known: true,
      channel: CHANNEL.openaiApi,
      kind: "api",
    });
    expect(
      replayChannel(
        "session-channel",
        { known: true, channel: "bedrock" },
        "anthropic",
      ),
    ).toEqual({ known: true, channel: CHANNEL.anthropicApi, kind: "api" });
  });

  it("keeps the session channel's reason when it is unknown", () => {
    expect(
      replayChannel(
        "session-channel",
        { known: false, reason: "no channel for x" },
        "openai",
      ),
    ).toEqual({ known: false, reason: "no channel for x" });
  });
});

describe("ReplayPricer", () => {
  it("gives AI Credits on the Copilot channel", () => {
    // Sonnet 5.5 on Copilot: $2 per million uncached input = 200 AI Credits.
    expect(
      pricer.price(
        request({
          usage: usage({
            model: "claude-sonnet-5.5",
            uncachedInput: k(1_000_000),
          }),
          channel: CHANNEL.githubCopilot,
          providerId: "vscode",
        }),
      ),
    ).toEqual({ known: true, value: 200, currency: "AI_CREDITS" });
  });

  it("gives USD on an API channel, at the price in force on the date", () => {
    const cacheRead = (at: string) =>
      pricer.price(
        request({
          usage: usage({ model: "claude-sonnet-5.5", cacheRead: k(1_000_000) }),
          at,
        }),
      );
    // Anthropic cut Sonnet 5.5's cache-read price on 2026-10-07.
    expect(cacheRead("2026-10-05T00:00:00Z")).toEqual({
      known: true,
      value: 0.2,
      currency: "USD",
    });
    expect(cacheRead("2026-10-10T00:00:00Z")).toEqual({
      known: true,
      value: 0.1,
      currency: "USD",
    });
  });

  it("prices recorded 1-hour writes at the 1-hour rate and the rest at the 5-minute rate", () => {
    // Opus 5.5 on the Anthropic API: $5/M 5-minute writes, $8/M 1-hour writes.
    const writes = (extended: number, providerId = "claude-code") =>
      pricer.price(
        request({
          usage: usage({
            cacheWrite: k(1_000_000),
            extendedCacheWrite: k(extended),
          }),
          providerId,
        }),
      );
    expect(writes(1_000_000)).toEqual({
      known: true,
      value: 8,
      currency: "USD",
    });
    expect(writes(0)).toEqual({ known: true, value: 5, currency: "USD" });
    expect(writes(250_000)).toEqual({
      known: true,
      value: 5.75,
      currency: "USD",
    });
    // The split, once given, wins over any provider default.
    expect(writes(1_000_000, "vscode")).toEqual({
      known: true,
      value: 8,
      currency: "USD",
    });
  });

  it("takes the provider's default lifetime for writes not split by lifetime", () => {
    const writes = (providerId: string) =>
      pricer.price(
        request({ usage: usage({ cacheWrite: k(1_000_000) }), providerId }),
      );
    // Claude Code writes with the 1-hour lifetime; Copilot with the 5-minute one.
    expect(writes("claude-code")).toEqual({
      known: true,
      value: 8,
      currency: "USD",
    });
    expect(writes("vscode")).toEqual({
      known: true,
      value: 5,
      currency: "USD",
    });
  });

  it("is unknown with the pricer's reason for a model the channel doesn't price", () => {
    const cost = pricer.price(
      request({
        usage: usage({ model: "mai-code-1.1-flash", uncachedInput: k(1000) }),
      }),
    );
    expect(cost.known).toBe(false);
    if (!cost.known) {
      expect(cost.reason).toContain("mai-code-1.1-flash");
      expect(cost.reason).toContain(CHANNEL.anthropicApi);
    }
  });

  it("is unknown before the model's first price version", () => {
    // Haiku 5.5's first Anthropic API price is from 2026-10-07.
    const cost = pricer.price(
      request({
        usage: usage({ model: "claude-haiku-5.5", uncachedInput: k(1000) }),
        at: "2026-10-03T00:00:00Z",
      }),
    );
    expect(cost.known).toBe(false);
  });

  it("is unknown with the usage's reason when the simulator gave no counts", () => {
    const reason = "Simulating Moonshot AI's cache isn't documented";
    const cost = pricer.price(
      request({
        usage: usage({ uncachedInput: na(reason), cacheRead: na(reason) }),
      }),
    );
    expect(cost.known).toBe(false);
    if (!cost.known) expect(cost.reason).toContain(reason);
  });

  it("asks the pricer as of use, at the request's time, with no scope and no API-equivalent label", () => {
    const seen: { request: PricingRequest; mode?: string }[] = [];
    const spy = new ReplayPricer({
      price: (req, mode) => {
        seen.push({ request: req, ...(mode ? { mode } : {}) });
        return costPricer.price(req, mode);
      },
    });
    spy.price(request({ at: "2026-10-12T08:00:00Z" }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.mode).toBe("as-of-use");
    expect(seen[0]!.request).toMatchObject({
      channel: { known: true, channel: CHANNEL.anthropicApi },
      turnStartedAt: "2026-10-12T08:00:00Z",
      scope: {},
      defaultCacheWriteLifetime: "extended",
      apiEquivalent: false,
    });
  });

  it("scales linearly with the tokens", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200_000 }),
        fc.integer({ min: 0, max: 200_000 }),
        fc.integer({ min: 0, max: 200_000 }),
        fc.integer({ min: 0, max: 50_000 }),
        fc.integer({ min: 1, max: 20 }),
        (uncached, read, write, output, factor) => {
          const at = (n: number) =>
            pricer.price(
              request({
                usage: usage({
                  uncachedInput: k(uncached * n),
                  cacheRead: k(read * n),
                  cacheWrite: k(write * n),
                  output: k(output * n),
                }),
              }),
            );
          const one = at(1);
          const many = at(factor);
          expect(one.known && many.known).toBe(true);
          if (one.known && many.known) {
            expect(many.value).toBeCloseTo(one.value * factor, 9);
          }
        },
      ),
    );
  });
});

describe("convertCost", () => {
  it("keeps a value in its own currency", () => {
    expect(convertCost(12.5, "USD", "USD")).toBe(12.5);
    expect(convertCost(7, "AI_CREDITS", "AI_CREDITS")).toBe(7);
  });

  it("converts at GitHub's documented 1 AI Credit = $0.01", () => {
    expect(convertCost(200, "AI_CREDITS", "USD")).toBeCloseTo(2, 12);
    expect(convertCost(2, "USD", "AI_CREDITS")).toBeCloseTo(200, 12);
  });
});
