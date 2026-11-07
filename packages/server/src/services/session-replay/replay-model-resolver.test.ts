import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { VendorProfile } from "@agent-cost-analyzer/domain";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { ReplayModelResolver } from "./replay-model-resolver.js";

// Step 14.4 (docs/plans/analyze-session-replay.md §12.1, "Open for 14.4"):
// a log's model id → the vendor profile model a replay simulates. Over the
// real bundled profiles.

const profiles = loadVendorProfiles();
const resolver = new ReplayModelResolver(profiles);

const simulatable = profiles.flatMap((profile) =>
  profile.models
    .filter(
      (model) => (model.cachingKind ?? profile.caching).kind !== "unknown",
    )
    .map((model) => ({ profile, model })),
);

describe("ReplayModelResolver", () => {
  it("maps Claude Code's hyphenated and dated ids to the profile's dotted id", () => {
    for (const id of [
      "claude-opus-5-5",
      "claude-opus-5-5-20261001",
      "claude-opus-5-5[1m]",
      "anthropic/claude-opus-5-5",
    ]) {
      const resolved = resolver.resolve(id);
      expect(resolved).toMatchObject({
        known: true,
        vendorId: "anthropic",
        modelId: "claude-opus-5.5",
      });
      if (resolved.known) expect(resolved.profile.vendorId).toBe("anthropic");
    }
  });

  it("maps a Copilot-prefixed id and keeps the profile's own spelling", () => {
    expect(resolver.resolve("copilot/Claude-Sonnet-4.6")).toMatchObject({
      known: true,
      vendorId: "anthropic",
      modelId: "claude-sonnet-4.6",
    });
    expect(resolver.resolve("gpt-6-sol")).toMatchObject({
      known: true,
      vendorId: "openai",
      modelId: "gpt-6-sol",
    });
  });

  it("guesses no near match: an unlisted id is unknown with a reason naming it", () => {
    const resolved = resolver.resolve("claude-opus-9-9");
    expect(resolved.known).toBe(false);
    if (!resolved.known) expect(resolved.reason).toContain('"claude-opus-9-9"');
  });

  it("says the log records no model for empty, unknown and synthetic ids", () => {
    for (const id of ["", "  ", "unknown", "<synthetic>"]) {
      const resolved = resolver.resolve(id);
      expect(resolved.known).toBe(false);
      if (!resolved.known)
        expect(resolved.reason).toContain("The log records no model");
    }
  });

  it("refuses a model whose caching is undocumented (Phase 13 D1)", () => {
    // Microsoft's and Moonshot's profiles say caching isn't documented.
    for (const id of ["mai-code-1.1-flash", "kimi-k3"]) {
      const resolved = resolver.resolve(id);
      expect(resolved.known).toBe(false);
      if (!resolved.known) {
        expect(resolved.reason).toContain(id);
        expect(resolved.reason).toMatch(/caching/i);
        expect(resolved.reason).toMatch(/undocumented|isn't documented/);
      }
    }
  });

  it("uses a model's own caching kind over its profile's", () => {
    const base = profiles.find((p) => p.vendorId === "anthropic")!;
    const model = base.models.find((m) => m.modelId === "claude-sonnet-4.6")!;
    const profile: VendorProfile = {
      ...base,
      models: [
        {
          ...model,
          cachingKind: { kind: "unknown", reason: "not documented" },
        },
      ],
    };
    expect(
      new ReplayModelResolver([profile]).resolve("claude-sonnet-4.6").known,
    ).toBe(false);
  });

  it("resolves every simulatable profile model id to itself, in any case", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...simulatable),
        fc.boolean(),
        ({ profile, model }, upper) => {
          const id = upper ? model.modelId.toUpperCase() : model.modelId;
          expect(resolver.resolve(id)).toEqual({
            known: true,
            vendorId: profile.vendorId,
            modelId: model.modelId,
            profile,
          });
        },
      ),
    );
  });

  it("knows no model when no profiles are loaded", () => {
    expect(new ReplayModelResolver([]).resolve("claude-opus-5.5").known).toBe(
      false,
    );
  });
});
