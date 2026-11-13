// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { ProfileCheaperModels } from "./cheaper-model-candidates.js";

// Phase 16 SR8 (docs/plans/savings-report.md §12 D5): the models a vendor's
// profile documents as cheaper, each the cheaper sibling of the one before,
// nearest first, at most 3, never from another vendor. Over the real profiles.
const profiles = loadVendorProfiles(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/vendor-profiles"));
const candidates = new ProfileCheaperModels(profiles);

describe("ProfileCheaperModels", () => {
  it("follows the cheaper-sibling chain, nearest first, up to 3 models", () => {
    expect(candidates.candidatesFor("claude-fable-5")).toEqual(["claude-opus-5.5", "claude-sonnet-5.5", "claude-haiku-5.5"]);
    expect(candidates.candidatesFor("claude-opus-5")).toEqual(["claude-sonnet-5", "claude-haiku-5.5"]);
  });

  it("resolves a log's spelling of the model", () => {
    expect(candidates.candidatesFor("claude-opus-5-20261001")).toEqual(candidates.candidatesFor("claude-opus-5"));
  });

  it("has none for the cheapest of a chain, an unknown model or no model", () => {
    expect(candidates.candidatesFor("claude-haiku-5.5")).toEqual([]);
    expect(candidates.candidatesFor("no-such-model")).toEqual([]);
    expect(candidates.candidatesFor("")).toEqual([]);
  });

  it("ends a cyclic chain instead of looping", () => {
    const [anthropic] = profiles.filter((profile) => profile.vendorId === "anthropic");
    const looped = { ...anthropic!, models: anthropic!.models.map((model) => (model.modelId === "claude-haiku-5.5" ? { ...model, cheaperSiblingId: "claude-sonnet-5" } : model)) };

    expect(new ProfileCheaperModels([looped]).candidatesFor("claude-sonnet-5")).toEqual(["claude-haiku-5.5"]);
  });
});
