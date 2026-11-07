// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  vendorComparisonSchema,
  vendorProfileSummarySchema,
} from "./vendor-comparison.js";

describe("vendorProfileSummarySchema", () => {
  const summary = {
    vendorId: "anthropic",
    displayName: "Anthropic",
    defaultModelId: "claude-sonnet-5.5",
    models: [
      {
        modelId: "claude-sonnet-5.5",
        displayName: "Claude Sonnet 5.5",
        simulated: true,
      },
      {
        modelId: "kimi",
        displayName: "Kimi",
        simulated: false,
        reason: "Not simulated: caching behaviour isn't documented",
      },
    ],
    assumptions: [{ text: "a", confidence: "unknown" }],
    sources: [{ id: "s", title: "t", url: "u", checkedAt: "2026-11-03" }],
    oldestCheckedAt: "2026-11-03",
  };

  it("accepts a summary with simulated and disabled models", () => {
    expect(vendorProfileSummarySchema.parse(summary)).toEqual(summary);
  });

  it("requires a reason for a model that is not simulated", () => {
    const bad = {
      ...summary,
      models: [{ modelId: "m", displayName: "M", simulated: false }],
    };
    expect(() => vendorProfileSummarySchema.parse(bad)).toThrow();
  });
});

describe("vendorComparisonSchema", () => {
  const turn = {
    index: 1,
    cacheOutcome: "hit",
    aiCredits: { known: true, value: 1.2 },
    note: "n",
    sourceIds: [],
  };

  it("accepts simulated and unsimulated entries", () => {
    const comparison = {
      scenarioId: "cache-basics",
      entries: [
        {
          vendorId: "anthropic",
          modelId: "claude-sonnet-5.5",
          displayName: "Claude Sonnet 5.5",
          simulated: true,
          totalAiCredits: { known: true, value: 1.2 },
          turns: [turn],
        },
        {
          vendorId: "xai",
          modelId: "grok-4.7",
          displayName: "Grok 4.7",
          simulated: false,
          reason: "No cheaper model is curated for this vendor.",
          turns: [],
        },
      ],
    };
    expect(vendorComparisonSchema.parse(comparison)).toEqual(comparison);
  });

  it("rejects a simulated entry without a total", () => {
    expect(() =>
      vendorComparisonSchema.parse({
        scenarioId: "s",
        entries: [
          {
            vendorId: "v",
            modelId: "m",
            displayName: "M",
            simulated: true,
            turns: [],
          },
        ],
      }),
    ).toThrow();
  });
});
