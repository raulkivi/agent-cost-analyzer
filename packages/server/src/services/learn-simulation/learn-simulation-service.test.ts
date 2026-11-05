import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadScenarioScripts } from "../../data-sources/learn-scripts/loader.js";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import {
  LearnSimulationService,
  ScenarioNotFoundError,
  UnknownModelError,
} from "./learn-simulation-service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const profiles = loadVendorProfiles(
  path.resolve(here, "../../../fixtures/vendor-profiles"),
);
const scripts = loadScenarioScripts();
const service = (harness: "claude-code" | "vscode-local" = "claude-code") =>
  new LearnSimulationService(scripts, profiles, harness);

describe("LearnSimulationService.getScenario", () => {
  it("defaults to the Anthropic default model", () => {
    const session = service().getScenario("cache-basics");
    expect(session.model).toBe("claude-sonnet-5.5");
    expect(session.turns[0]!.simulation?.vendorId).toBe("anthropic");
  });

  it("replays on the requested model", () => {
    const session = service().getScenario("cache-basics", "gpt-6.1-sol");
    expect(session.turns[0]!.simulation?.modelId).toBe("gpt-6.1-sol");
  });

  it("throws ScenarioNotFoundError for an unknown id", () => {
    expect(() => service().getScenario("nope")).toThrow(ScenarioNotFoundError);
  });

  it("treats a scenario not applicable to the harness as not found", () => {
    // The 1-hour cache is Anthropic API only: Copilot users can't pick it (D13).
    expect(() =>
      service("vscode-local").getScenario("cache-ttl-1-hour-breakpoint"),
    ).toThrow(ScenarioNotFoundError);
  });

  it("throws UnknownModelError for an unknown model id", () => {
    expect(() => service().getScenario("cache-basics", "nope")).toThrow(
      UnknownModelError,
    );
  });

  it("throws UnknownModelError for a model that is not simulated", () => {
    const unsimulated = profiles
      .flatMap((p) => p.models.map((m) => ({ p, m })))
      .find(({ p, m }) => (m.cachingKind ?? p.caching).kind === "unknown")!;
    expect(() =>
      service().getScenario("cache-basics", unsimulated.m.modelId),
    ).toThrow(/Not simulated/);
  });
});

describe("LearnSimulationService.compareScenario", () => {
  it("defaults to each simulated vendor's default model", () => {
    const comparison = service().compareScenario("cache-basics");
    expect(comparison.entries.map((e) => e.vendorId)).toEqual([
      "anthropic",
      "google",
      "openai",
      "xai",
    ]);
    for (const entry of comparison.entries) {
      expect(entry.simulated).toBe(true);
      expect(entry.turns).toHaveLength(8);
      expect(entry.totalAiCredits?.known).toBe(true);
    }
  });

  it("reports a model that cannot be simulated instead of dropping it", () => {
    const comparison = service().compareScenario("model-switch", [
      "claude-sonnet-5.5",
      "grok-4.7",
    ]);
    const xai = comparison.entries.find((e) => e.vendorId === "xai")!;
    expect(xai).toMatchObject({ simulated: false, turns: [] });
    expect(xai.reason).toMatch(/cheaper/i);
    expect(comparison.entries[0]!.simulated).toBe(true);
  });

  it("marks the total unavailable when a turn is unknown", () => {
    const comparison = service().compareScenario(
      "image-attachment-invalidation",
      ["grok-4.7"],
    );
    const entry = comparison.entries[0]!;
    expect(entry.totalAiCredits?.known).toBe(false);
    expect(entry.turns.some((t) => t.cacheOutcome === "unknown")).toBe(true);
  });

  it("throws UnknownModelError for an unknown model id", () => {
    expect(() => service().compareScenario("cache-basics", ["nope"])).toThrow(
      UnknownModelError,
    );
  });
});

describe("LearnSimulationService.listVendorProfiles", () => {
  it("lists every vendor with a reason on models that are not simulated", () => {
    const list = service().listVendorProfiles();
    expect(list.map((v) => v.vendorId).sort()).toEqual(
      profiles.map((p) => p.vendorId).sort(),
    );
    const moonshot = list.find((v) => v.vendorId === "moonshot")!;
    expect(moonshot.models.every((m) => !m.simulated)).toBe(true);
    expect(moonshot.models[0]!.reason).toBe(
      "Not simulated: caching behaviour isn't documented",
    );
  });

  it("gives the oldest source date for the staleness warning", () => {
    for (const v of service().listVendorProfiles()) {
      expect(v.oldestCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });
});
