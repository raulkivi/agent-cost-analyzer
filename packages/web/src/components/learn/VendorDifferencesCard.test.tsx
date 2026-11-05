import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { VendorComparison, VendorProfileSummary } from "@agent-cost-analyzer/domain";
import { axeViolations } from "../../test-support/axe.js";
import { VendorDifferencesCard, hasCacheEvent } from "./VendorDifferencesCard.js";
import { makeTurn } from "../../test-support/turn-fixture.js";

const profile = (vendorId: string, displayName: string, defaultModelId: string): VendorProfileSummary => ({
  vendorId,
  displayName,
  defaultModelId,
  models: [{ modelId: defaultModelId, displayName: defaultModelId, simulated: true }],
  assumptions: [],
  sources: [{ id: `${vendorId}-doc`, title: `${displayName} caching docs`, url: `https://example.com/${vendorId}`, checkedAt: "2026-11-03" }],
  oldestCheckedAt: "2026-11-03",
});

const profiles = [
  profile("anthropic", "Anthropic", "sonnet"),
  profile("openai", "OpenAI", "gpt"),
  profile("xai", "xAI", "grok"),
];

const comparison: VendorComparison = {
  scenarioId: "image",
  entries: [
    {
      vendorId: "anthropic",
      modelId: "sonnet",
      displayName: "Claude Sonnet 5.5",
      simulated: true,
      totalAiCredits: { known: true, value: 3 },
      turns: [
        { index: 1, cacheOutcome: "miss", aiCredits: { known: true, value: 1 }, note: "first", sourceIds: [] },
        {
          index: 2,
          cacheOutcome: "partial",
          aiCredits: { known: true, value: 2 },
          note: "The image invalidated the conversation cache.",
          sourceIds: ["anthropic-doc"],
        },
      ],
    },
    {
      vendorId: "openai",
      modelId: "gpt",
      displayName: "GPT",
      simulated: true,
      totalAiCredits: { known: false, reason: "unknown" },
      turns: [
        { index: 1, cacheOutcome: "miss", aiCredits: { known: true, value: 1 }, note: "first", sourceIds: [] },
        { index: 2, cacheOutcome: "unknown", aiCredits: { known: false, reason: "r" }, note: "OpenAI's rule is unknown.", sourceIds: [] },
      ],
    },
    {
      vendorId: "xai",
      modelId: "grok",
      displayName: "Grok",
      simulated: false,
      reason: "No cheaper model is curated for this vendor.",
      turns: [],
    },
    // Not a vendor default: only default models appear in the card.
    {
      vendorId: "anthropic",
      modelId: "opus",
      displayName: "Claude Opus",
      simulated: true,
      totalAiCredits: { known: true, value: 9 },
      turns: [{ index: 2, cacheOutcome: "hit", aiCredits: { known: true, value: 9 }, note: "x", sourceIds: [] }],
    },
  ],
};

describe("VendorDifferencesCard", () => {
  it("lists one row per vendor default model for the turn, with outcome, credits and note", () => {
    render(<VendorDifferencesCard comparison={comparison} turnIndex={2} profiles={profiles} />);
    expect(screen.getByRole("heading", { name: "How vendors differ" })).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("Claude Sonnet 5.5")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Cache partial hit")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("2.00")).toHaveAttribute("title", "≈ $0.02");
    expect(within(rows[0]!).getByText("The image invalidated the conversation cache.")).toBeInTheDocument();
    expect(screen.queryByText("Claude Opus")).not.toBeInTheDocument();
  });

  it("links each source id to the vendor's source", () => {
    render(<VendorDifferencesCard comparison={comparison} turnIndex={2} profiles={profiles} />);
    expect(screen.getByRole("link", { name: "Anthropic caching docs" })).toHaveAttribute(
      "href",
      "https://example.com/anthropic",
    );
  });

  it("shows unavailable credits, never zero, for an unknown turn", () => {
    render(<VendorDifferencesCard comparison={comparison} turnIndex={2} profiles={profiles} />);
    const row = screen.getAllByRole("listitem")[1]!;
    expect(within(row).getByText("Cache outcome unknown")).toBeInTheDocument();
    expect(within(row).getByText("unavailable")).toBeInTheDocument();
  });

  it("shows the reason for a vendor that is not simulated", () => {
    render(<VendorDifferencesCard comparison={comparison} turnIndex={2} profiles={profiles} />);
    expect(screen.getByText("No cheaper model is curated for this vendor.")).toBeInTheDocument();
  });

  it("renders nothing without a comparison", () => {
    const { container } = render(<VendorDifferencesCard comparison={null} turnIndex={2} profiles={profiles} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("has no axe violations", async () => {
    const { container } = render(<VendorDifferencesCard comparison={comparison} turnIndex={2} profiles={profiles} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("hasCacheEvent", () => {
  const simulation = (cacheOutcome: "hit" | "miss") => ({
    vendorId: "v",
    modelId: "m",
    cacheOutcome,
    note: "n",
    confidence: "inferred" as const,
    sourceIds: [],
  });
  it("is true for a triggered event or a non-hit outcome", () => {
    expect(hasCacheEvent(makeTurn({ triggeredEvent: "clear", simulation: simulation("hit") }))).toBe(true);
    expect(hasCacheEvent(makeTurn({ simulation: simulation("miss") }))).toBe(true);
  });
  it("is false for a plain hit and for a turn with no simulation", () => {
    expect(hasCacheEvent(makeTurn({ simulation: simulation("hit") }))).toBe(false);
    expect(hasCacheEvent(makeTurn({ triggeredEvent: "clear" }))).toBe(false);
  });
});
