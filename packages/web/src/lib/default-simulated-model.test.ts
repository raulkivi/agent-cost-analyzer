import { describe, expect, it } from "vitest";
import type { VendorProfileSummary } from "@agent-cost-analyzer/domain";
import { defaultSimulatedModel } from "./default-simulated-model.js";

const profile = (vendorId: string, models: [string, string, boolean][]): VendorProfileSummary => ({
  vendorId,
  displayName: vendorId,
  defaultModelId: models[0]![0],
  models: models.map(([modelId, displayName, simulated]) => ({
    modelId,
    displayName,
    simulated,
    ...(simulated ? {} : { reason: "Not simulated" }),
  })),
  assumptions: [],
  sources: [],
  oldestCheckedAt: "2026-11-03",
});

const profiles = [
  profile("anthropic", [
    ["claude-sonnet-5.5", "Claude Sonnet 5.5", true],
    ["claude-opus-5.5", "Claude Opus 5.5", true],
  ]),
  profile("openai", [["gpt-6.1-sol", "GPT-6.1 Sol", true]]),
  profile("moonshot", [["kimi-k3", "Kimi K3", false]]),
];
const used = (model: string) => ({ model });

describe("defaultSimulatedModel (D3)", () => {
  it("picks the simulated model used by most recent Analyze sessions", () => {
    expect(
      defaultSimulatedModel([used("gpt-6.1-sol"), used("gpt-6.1-sol"), used("claude-opus-5.5")], profiles),
    ).toBe("gpt-6.1-sol");
  });

  it("matches the model id or the display name, ignoring case", () => {
    expect(defaultSimulatedModel([used("Claude Opus 5.5")], profiles)).toBe("claude-opus-5.5");
  });

  it("ignores models that are not simulated", () => {
    expect(defaultSimulatedModel([used("kimi-k3")], profiles)).toBe("claude-sonnet-5.5");
  });

  it("falls back to Claude Sonnet 5.5 with no usable sessions", () => {
    expect(defaultSimulatedModel([], profiles)).toBe("claude-sonnet-5.5");
    expect(defaultSimulatedModel([used("unknown")], profiles)).toBe("claude-sonnet-5.5");
  });

  it("falls back to the first simulated model when Sonnet 5.5 is absent", () => {
    expect(defaultSimulatedModel([], [profiles[1]!])).toBe("gpt-6.1-sol");
  });
});
