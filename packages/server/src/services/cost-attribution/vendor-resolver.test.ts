// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { candidateModelIds, ProfileVendorResolver, type VendorCatalogEntry } from "./vendor-resolver.js";

const catalog: VendorCatalogEntry[] = [
  { vendorId: "anthropic", displayName: "Anthropic", models: [{ modelId: "claude-sonnet-5.5" }, { modelId: "claude-opus-5" }] },
  { vendorId: "openai", displayName: "OpenAI", models: [{ modelId: "gpt-6-luna" }, { modelId: "gpt-5.3-codex" }] },
  { vendorId: "acme", displayName: "Acme", models: [{ modelId: "shared-1" }] },
  { vendorId: "other", displayName: "Other", models: [{ modelId: "shared-2" }] },
];

describe("candidateModelIds", () => {
  it("tries the id as recorded, then without a provider prefix, date suffix or context tag, then with a dotted version", () => {
    expect(candidateModelIds("claude-sonnet-5.5")).toEqual(["claude-sonnet-5.5"]);
    expect(candidateModelIds("Copilot/Claude-Sonnet-5.5")).toEqual(["copilot/claude-sonnet-5.5", "claude-sonnet-5.5"]);
    expect(candidateModelIds("claude-opus-5-5-20261001")).toEqual(["claude-opus-5-5-20261001", "claude-opus-5-5", "claude-opus-5.5"]);
    expect(candidateModelIds("claude-opus-5[1m]")).toEqual(["claude-opus-5[1m]", "claude-opus-5"]);
    // Step 15.6: a display-style name with spaces.
    expect(candidateModelIds("Claude Sonnet 5.5")).toEqual(["claude sonnet 5.5", "claude-sonnet-5.5"]);
  });
});

describe("ProfileVendorResolver", () => {
  const resolver = new ProfileVendorResolver(catalog);

  it("finds the vendor of a model a profile lists, also under the provider's own spelling", () => {
    expect(resolver.vendorOf("claude-sonnet-5.5")).toEqual({ known: true, vendorId: "anthropic", basis: "profile" });
    expect(resolver.vendorOf("claude-sonnet-5-5")).toEqual({ known: true, vendorId: "anthropic", basis: "profile" });
    expect(resolver.vendorOf("anthropic/claude-opus-5-20261001")).toEqual({ known: true, vendorId: "anthropic", basis: "profile" });
  });

  it("infers the vendor from a model family that only one vendor's profile has", () => {
    expect(resolver.vendorOf("claude-haiku-9")).toEqual({ known: true, vendorId: "anthropic", basis: "model-family" });
    expect(resolver.vendorOf("gpt-7")).toEqual({ known: true, vendorId: "openai", basis: "model-family" });
  });

  it("keeps the vendor unknown, with a reason, for a model no profile or single family covers", () => {
    const unknown = resolver.vendorOf("o9-mini");
    expect(unknown).toEqual({ known: false, reason: expect.stringContaining('"o9-mini"') });
    // Two vendors share the family: no guess.
    expect(resolver.vendorOf("shared-3")).toMatchObject({ known: false });
  });

  it("keeps a missing model unknown", () => {
    expect(resolver.vendorOf("")).toMatchObject({ known: false, reason: expect.stringMatching(/no model/i) });
    expect(resolver.vendorOf("unknown")).toMatchObject({ known: false, reason: expect.stringMatching(/no model/i) });
  });

  it("labels a vendor by its profile's display name", () => {
    expect(resolver.label("openai")).toBe("OpenAI");
    expect(resolver.label("nobody")).toBe("nobody");
  });

  it("says why every vendor is unknown when no profiles are loaded", () => {
    expect(new ProfileVendorResolver([]).vendorOf("claude-sonnet-5.5")).toEqual({
      known: false,
      reason: expect.stringMatching(/no vendor profiles/i),
    });
  });

  it("resolves the fixtures' model ids against the bundled Phase 13 profiles", () => {
    const bundled = new ProfileVendorResolver(loadVendorProfiles());
    expect(bundled.vendorOf("claude-opus-5-5")).toMatchObject({ known: true, vendorId: "anthropic" });
    expect(bundled.vendorOf("gpt-6-luna")).toMatchObject({ known: true, vendorId: "openai", basis: "profile" });
    expect(bundled.vendorOf("gemini-3.8-flash")).toMatchObject({ known: true, vendorId: "google" });
    expect(bundled.vendorOf("grok-4.7")).toMatchObject({ known: true, vendorId: "xai" });
    expect(bundled.vendorOf("example-model")).toMatchObject({ known: false });
  });
});
