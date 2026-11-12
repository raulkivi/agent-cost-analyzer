// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { CHANNEL, vendorApiChannel, type SessionReplay } from "@agent-cost-analyzer/domain";
import type { PriceBook } from "../pricing/price-book.js";
import { CandidatePriceModelMapper } from "../pricing/price-model-mapper.js";

// Phase 16 SR10 (docs/plans/savings-report.md §7): the price versions behind
// a replay's simulated cost, for the cheaper-model saving to show. The replay
// names its price channel, model and date; the book says which version was
// in force then, as the replay's own pricer found it (same channel, same
// model-id mapping, list price). None found: the detector makes the amount
// unknown rather than unsourced.

export type ReplayPriceFields = Pick<SessionReplay, "model" | "vendorId" | "pricing">;

function channelOf(replay: ReplayPriceFields): string | undefined {
  switch (replay.pricing.channel) {
    case "copilot":
      return CHANNEL.githubCopilot;
    case "api":
      return vendorApiChannel(replay.vendorId);
    case null:
      return undefined;
  }
}

export function replayPriceVersions(book: Pick<PriceBook, "priceFor" | "modelIds">): (replay: ReplayPriceFields) => string[] {
  const models = new CandidatePriceModelMapper(book);
  return (replay) => {
    const channel = channelOf(replay);
    if (channel === undefined) return [];
    const model = models.priceModelFor(channel, replay.model);
    if (!model.known) return [];
    const lookup = book.priceFor(channel, model.modelId, replay.pricing.asOf);
    return lookup.known ? [lookup.version.id] : [];
  };
}
