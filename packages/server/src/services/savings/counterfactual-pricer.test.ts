// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { BundledPriceBookSource, defaultPriceBookDir } from "../pricing/bundled-price-book-source.js";
import { CostPricer } from "../pricing/cost-pricer.js";
import { PriceBook } from "../pricing/price-book.js";
import { CandidatePriceModelMapper } from "../pricing/price-model-mapper.js";
import { CounterfactualPricer, type CounterfactualQuery } from "./counterfactual-pricer.js";

// Phase 16 SR3 (docs/plans/savings-report.md §4, §5.2): what N tokens would
// have cost billed as one token type versus another, through CostPricer. The
// golden figures are hand-computed from the bundled price book, claude-sonnet-5
// from 2026-10-01 (identical on both channels; USD per million tokens):
//   input 2, cache read 0.2, 5-minute cache write 2.5
// and on github-copilot 1 AI Credit = $0.01, so 200, 20 and 250 credits.
const book = new PriceBook(new BundledPriceBookSource(defaultPriceBookDir())).snapshot();
const NOW = new Date("2026-11-06T10:00:00Z");
const pricer = new CounterfactualPricer(new CostPricer({ prices: book, models: new CandidatePriceModelMapper(book), now: () => NOW }));

const MILLION = 1_000_000;
const API = { known: true, channel: "anthropic-api" } as const;
const COPILOT = { known: true, channel: "github-copilot" } as const;

function query(overrides: Partial<CounterfactualQuery> = {}): CounterfactualQuery {
  return { model: "claude-sonnet-5", channel: API, at: "2026-10-15T12:00:00Z", tokens: MILLION, billedAs: "uncachedInput", instead: "cacheRead", ...overrides };
}

describe("CounterfactualPricer", () => {
  it("prices the difference between two token types on the Anthropic API, in USD", () => {
    const saving = pricer.saving(query());

    expect(saving).toMatchObject({ known: true, currency: "USD", priceVersionIds: ["anthropic-api:claude-sonnet-5:2026-10-01"] });
    if (saving.known) {
      expect(saving.low).toBeCloseTo(1.8, 9);
      expect(saving.high).toBeCloseTo(1.8, 9);
    }
  });

  it("prices it in AI Credits on GitHub Copilot", () => {
    const saving = pricer.saving(query({ channel: COPILOT }));

    expect(saving).toMatchObject({ known: true, currency: "AI_CREDITS", priceVersionIds: ["github-copilot:claude-sonnet-5:2026-10-01"] });
    if (saving.known) {
      expect(saving.low).toBeCloseTo(180, 6);
      expect(saving.high).toBeCloseTo(180, 6);
    }
  });

  it("scales with the token count", () => {
    const saving = pricer.saving(query({ tokens: 250_000 }));

    expect(saving.known && saving.high).toBeCloseTo(0.45, 9);
  });

  it("gives a range when the tokens were billed at one of several rates (a tool's tokens: cache read or uncached)", () => {
    const saving = pricer.saving(query({ billedAs: ["cacheRead", "uncachedInput"], instead: "nothing" }));

    expect(saving.known && [saving.low, saving.high]).toEqual([expect.closeTo(0.2, 9), expect.closeTo(2, 9)]);
  });

  it("gives a range for unknown cache writes: billed as a write or as plain uncached input", () => {
    const saving = pricer.saving(query({ billedAs: ["cacheWrite", "uncachedInput"], instead: "cacheRead" }));

    expect(saving.known && [saving.low, saving.high]).toEqual([expect.closeTo(1.8, 9), expect.closeTo(2.3, 9)]);
  });

  it("prices cache writes at the extended rate when the caller says the lifetime is extended", () => {
    const saving = pricer.saving(query({ billedAs: "cacheWrite", instead: "nothing", cacheWriteLifetime: "extended" }));

    // claude-sonnet-5 1-hour write: 4 USD per million.
    expect(saving.known && saving.high).toBeCloseTo(4, 9);
  });

  it("claims no saving, not a negative one, when the other type costs more", () => {
    const saving = pricer.saving(query({ billedAs: "cacheRead", instead: "uncachedInput" }));

    expect(saving).toMatchObject({ known: true, low: 0, high: 0 });
  });

  it("is 0 to 0 for no tokens", () => {
    expect(pricer.saving(query({ tokens: 0 }))).toMatchObject({ known: true, low: 0, high: 0 });
  });

  it("is unknown, with the reason, for a model the price book does not have", () => {
    const saving = pricer.saving(query({ model: "mystery-model" }));

    expect(saving).toEqual({ known: false, reason: expect.stringContaining("mystery-model") });
  });

  it("is unknown, with the reason, for a date before the price book starts", () => {
    const saving = pricer.saving(query({ at: "2026-09-01T00:00:00Z" }));

    expect(saving).toEqual({ known: false, reason: expect.stringContaining("Cannot price") });
  });

  it("is unknown, with the channel's reason, when no channel is known", () => {
    const saving = pricer.saving(query({ channel: { known: false, reason: "No channel is known for this provider." } }));

    expect(saving).toEqual({ known: false, reason: expect.stringContaining("No channel is known") });
  });

  it("is unknown when the date is missing in as-of-use mode, and priced at today's prices in today mode", () => {
    const withoutDate: CounterfactualQuery = { ...query(), at: undefined };

    expect(pricer.saving(withoutDate)).toMatchObject({ known: false });
    expect(pricer.saving(withoutDate, "today")).toMatchObject({ known: true, currency: "USD" });
  });
});
