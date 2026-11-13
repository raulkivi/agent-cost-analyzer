// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { cacheRulesFromProfiles, cacheRulesOf } from "./cache-rules.js";

// Phase 16 SR4: the vendor profiles' caching kinds as the classifier's
// rules (minimum cacheable tokens, lifetime), over the real bundled profiles.

const rules = cacheRulesFromProfiles(loadVendorProfiles());

describe("cacheRulesOf", () => {
  it("takes a breakpoints vendor's default and extended lifetimes and its minimum", () => {
    expect(
      cacheRulesOf({ kind: "breakpoints", defaultTtlMinutes: 5, extendedTtlMinutes: 60, refreshOnHit: true, minCacheableTokens: 1024, layers: ["tools"] }, "Anthropic's claude-sonnet-5"),
    ).toEqual({ known: true, minCacheableTokens: 1024, lifetime: { minMinutes: 5, maxMinutes: 5 }, extendedLifetimeMinutes: 60 });
  });

  it("leaves out the extended lifetime when the vendor has none", () => {
    expect(cacheRulesOf({ kind: "breakpoints", defaultTtlMinutes: 5, refreshOnHit: true, minCacheableTokens: 1024, layers: [] }, "x")).not.toHaveProperty("extendedLifetimeMinutes");
  });

  it("takes an automatic-prefix vendor's fixed lifetime or its documented range", () => {
    expect(cacheRulesOf({ kind: "automatic-prefix", ttlMinutes: { fixed: 30 }, writeCharged: true, minCacheableTokens: 1024 }, "x")).toEqual({
      known: true,
      minCacheableTokens: 1024,
      lifetime: { minMinutes: 30, maxMinutes: 30 },
    });
    expect(cacheRulesOf({ kind: "automatic-prefix", ttlMinutes: { min: 5, max: 60 }, writeCharged: false, minCacheableTokens: 128 }, "x")).toMatchObject({
      lifetime: { minMinutes: 5, maxMinutes: 60 },
    });
  });

  it("is unknown with the reason for a best-effort or undocumented vendor, never a guessed lifetime", () => {
    expect(cacheRulesOf({ kind: "best-effort", note: "n" }, "xAI's grok")).toEqual({
      known: false,
      reason: "xAI's grok caches on a best-effort basis: no cache lifetime or minimum cacheable length is documented, so its cache breaks can't be classified.",
    });
    expect(cacheRulesOf({ kind: "unknown", reason: "not documented" }, "Microsoft's mai")).toEqual({
      known: false,
      reason: "Microsoft's mai documents no caching rules (not documented), so its cache breaks can't be classified.",
    });
  });
});

describe("cacheRulesFromProfiles", () => {
  it("resolves Claude Code's spelling to the model's own rules", () => {
    expect(rules("claude-sonnet-5-20261001")).toEqual({ known: true, minCacheableTokens: 1024, lifetime: { minMinutes: 5, maxMinutes: 5 }, extendedLifetimeMinutes: 60 });
  });

  it("uses a model's own caching kind over its profile's (GPT-6.1 Sol: 30 minutes)", () => {
    expect(rules("gpt-6.1-sol")).toEqual({ known: true, minCacheableTokens: 1024, lifetime: { minMinutes: 30, maxMinutes: 30 } });
  });

  it("is unknown for a best-effort vendor and for a model no profile lists", () => {
    expect(rules("mai-code-1.1-flash")).toMatchObject({ known: false, reason: expect.stringContaining("Microsoft's mai-code-1.1-flash documents no caching rules") });
    expect(rules("no-such-model")).toEqual({
      known: false,
      reason: 'No vendor profile lists the model "no-such-model", so its caching rules are unknown.',
    });
  });
});
