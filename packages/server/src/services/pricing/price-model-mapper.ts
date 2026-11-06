import { candidateModelIds } from "../cost-attribution/vendor-resolver.js";

// Phase 15 step 15.6 (docs/plans/cost-by-repository-and-project.md §6.1):
// a provider's own model id → the price book's model id on a channel.
// Providers spell ids their own way (Claude Code `claude-opus-5-5-20261001`,
// a `[1m]` tag, a `copilot/` prefix, a display name with spaces); the same
// spellings step 15.4's vendor resolver tries (candidateModelIds, shared,
// not copied) are tried against the ids the channel prices. No near match
// is guessed: an id with no exact candidate stays unknown with a reason
// (constraint 6).

export type PriceModelResolution = { known: true; modelId: string } | { known: false; reason: string };

export interface PriceModelMapper {
  priceModelFor(channel: string, recordedModelId: string): PriceModelResolution;
}

// The read slice of PriceBook this needs (DIP).
export interface PricedModelCatalog {
  modelIds(channel: string): readonly string[];
}

const NO_MODEL_IDS = new Set(["", "unknown", "<synthetic>"]);

export class CandidatePriceModelMapper implements PriceModelMapper {
  constructor(private readonly catalog: PricedModelCatalog) {}

  priceModelFor(channel: string, recordedModelId: string): PriceModelResolution {
    if (NO_MODEL_IDS.has(recordedModelId.trim().toLowerCase())) {
      return { known: false, reason: "The log records no model for this turn." };
    }
    const priced = new Set(this.catalog.modelIds(channel).map((id) => id.toLowerCase()));
    if (priced.size === 0) {
      return { known: false, reason: `The price book has no prices for the channel ${channel}.` };
    }
    const match = candidateModelIds(recordedModelId).find((candidate) => priced.has(candidate));
    if (match === undefined) {
      return { known: false, reason: `The price book has no model matching ${JSON.stringify(recordedModelId)} on ${channel}.` };
    }
    // Back to the book's own spelling.
    return { known: true, modelId: this.catalog.modelIds(channel).find((id) => id.toLowerCase() === match)! };
  }
}
