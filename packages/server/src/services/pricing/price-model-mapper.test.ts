import { describe, expect, it } from "vitest";
import { CandidatePriceModelMapper } from "./price-model-mapper.js";

// Step 15.6: provider model ids → the price book's model ids on a channel.
const catalog = {
  modelIds: (channel: string) =>
    channel === "github-copilot"
      ? ["claude-opus-5.5", "claude-sonnet-5.5", "gpt-6.1-sol"]
      : channel === "anthropic-api"
        ? ["claude-opus-5.5", "claude-sonnet-5.5", "claude-sonnet-5.5-fast"]
        : [],
};
const mapper = new CandidatePriceModelMapper(catalog);

describe("CandidatePriceModelMapper", () => {
  it("keeps an id the price book already uses", () => {
    expect(mapper.priceModelFor("github-copilot", "claude-sonnet-5.5")).toEqual({ known: true, modelId: "claude-sonnet-5.5" });
  });

  it("maps Claude Code's dated, hyphenated ids and a [1m] tag to the price-book id", () => {
    expect(mapper.priceModelFor("anthropic-api", "claude-opus-5-5-20261001")).toEqual({ known: true, modelId: "claude-opus-5.5" });
    expect(mapper.priceModelFor("anthropic-api", "claude-sonnet-5-5[1m]")).toEqual({ known: true, modelId: "claude-sonnet-5.5" });
  });

  it("maps a vendor-prefixed or display-style Copilot id", () => {
    expect(mapper.priceModelFor("github-copilot", "copilot/GPT-6.1-Sol")).toEqual({ known: true, modelId: "gpt-6.1-sol" });
    expect(mapper.priceModelFor("github-copilot", "Claude Sonnet 5.5")).toEqual({ known: true, modelId: "claude-sonnet-5.5" });
  });

  it("is unknown with a reason for a model the channel doesn't price, never a near match", () => {
    const result = mapper.priceModelFor("github-copilot", "claude-sonnet-5.6");
    expect(result).toEqual({ known: false, reason: 'The price book has no model matching "claude-sonnet-5.6" on github-copilot.' });
  });

  it("is unknown with a reason for a channel with no price book, and for no model", () => {
    expect(mapper.priceModelFor("xai-api", "grok-4.7")).toEqual({ known: false, reason: "The price book has no prices for the channel xai-api." });
    expect(mapper.priceModelFor("github-copilot", "unknown")).toEqual({ known: false, reason: "The log records no model for this turn." });
    expect(mapper.priceModelFor("anthropic-api", "<synthetic>")).toEqual({ known: false, reason: "The log records no model for this turn." });
  });
});
