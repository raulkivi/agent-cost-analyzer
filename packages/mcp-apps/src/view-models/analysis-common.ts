// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostCurrencyChoice, InsightProviderStatus, PriceChange, PriceChangeMarker, PricingMode } from "@agent-cost-analyzer/domain";
import { formatDay } from "./format.js";
import { formatUnitPrice } from "./money.js";

// Parts the cost-analysis view models (U9 to U11) share.

// A change against a period with nothing known: never "from 0" (§4.5).
export const NO_EARLIER_FIGURE = "no earlier figure";

export function pricingText(pricing: PricingMode): string {
  return pricing === "today" ? "today's prices" : "prices as of use";
}

// Said only when figures were converted (a usd view); native keeps units apart.
export function conversionNoteFor(currency: CostCurrencyChoice, conversion: string): string | undefined {
  return currency === "usd" ? conversion : undefined;
}

// Partial coverage by provider: what was not read, and why.
export function providerIssues(providers: readonly InsightProviderStatus[]): string[] {
  return providers.flatMap((provider) => {
    const issues: string[] = [];
    if (!provider.available) issues.push(`${provider.label}: ${provider.unavailableReason ?? "unavailable"}`);
    if (provider.error !== undefined) issues.push(`${provider.label}: ${provider.error}`);
    if (provider.truncated) issues.push(`${provider.label}: more sessions matched than the limit; the figures cover the most recent ones`);
    return issues;
  });
}

const TOKEN_TYPE_TEXT: Record<PriceChange["tokenType"], string> = {
  input: "input",
  cachedInput: "cached input",
  cacheWrite: "cache write",
  extendedCacheWrite: "extended cache write",
  output: "output",
};

export interface PriceChangeLine {
  tokenText: string;
  fromText: string; // USD per 1M tokens, or "none"
  toText: string;
  percentText?: string; // absent when either side has no price
}

export interface DocumentedPriceChange {
  kind: "documented";
  inferred: false;
  date: string;
  dateText: string;
  channel: string;
  modelId: string;
  lines: PriceChangeLine[];
}

export function documentedPriceChange(marker: PriceChangeMarker): DocumentedPriceChange {
  return {
    kind: "documented",
    inferred: false,
    date: marker.date,
    dateText: formatDay(marker.date) ?? marker.date,
    channel: marker.channel,
    modelId: marker.modelId,
    lines: marker.changes.map((change): PriceChangeLine => ({
      tokenText: TOKEN_TYPE_TEXT[change.tokenType],
      fromText: formatUnitPrice(change.fromUsdPerM, "USD"),
      toText: formatUnitPrice(change.toUsdPerM, "USD"),
      ...(change.percent === null ? {} : { percentText: `${change.percent > 0 ? "+" : change.percent < 0 ? "−" : ""}${Math.abs(change.percent).toFixed(2)} %` }),
    })),
  };
}
