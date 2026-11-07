// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { VendorProfile } from "@agent-cost-analyzer/domain";

// Phase 15 step 15.4 (docs/plans/cost-by-repository-and-project.md §3, §8):
// the vendor (model maker) of a recorded model id, read from Phase 13's
// vendor profiles (VendorProfile.vendorId and models[].modelId) without
// changing them. Providers spell model ids their own way (Claude Code
// `claude-opus-5-5-20261001`, Copilot `claude-sonnet-5.5`, a `vendor/` prefix
// in some logs), so a few spellings are tried against the profiles first
// (`basis: "profile"`). Failing that, a model family (the id's first
// segment, `claude`, `gpt`, ...) that only one vendor's profiles use names
// that vendor (`basis: "model-family"`). Anything else stays unknown with the
// reason (constraint 6): no vendor is guessed.

export type VendorResolution =
  | { known: true; vendorId: string; basis: "profile" | "model-family" }
  | { known: false; reason: string };

export interface VendorResolver {
  vendorOf(modelId: string): VendorResolution;
  // The vendor's display name; its id when no profile names it.
  label(vendorId: string): string;
}

// The read-only slice of a VendorProfile this needs.
export type VendorCatalogEntry = Pick<VendorProfile, "vendorId" | "displayName"> & {
  models: readonly Pick<VendorProfile["models"][number], "modelId">[];
};

const NO_MODEL_IDS = new Set(["", "unknown", "<synthetic>"]);

const allDigits = (value: string, length?: number) =>
  value.length > 0 && (length === undefined || value.length === length) && [...value].every((ch) => ch >= "0" && ch <= "9");

// Without a trailing release date: `-20261001` or `-2026-10-01`.
function withoutDate(id: string): string {
  const parts = id.split("-");
  if (parts.length > 1 && allDigits(parts.at(-1)!, 8)) {
    return parts.slice(0, -1).join("-");
  }
  if (parts.length > 3 && allDigits(parts.at(-3)!, 4) && allDigits(parts.at(-2)!, 2) && allDigits(parts.at(-1)!, 2)) {
    return parts.slice(0, -3).join("-");
  }
  return id;
}

// `claude-opus-5-5` → `claude-opus-5.5`: a hyphenated major-minor version.
function dottedVersion(id: string): string {
  const parts = id.split("-");
  if (parts.length > 2 && allDigits(parts.at(-1)!) && allDigits(parts.at(-2)!)) {
    return `${parts.slice(0, -2).join("-")}-${parts.at(-2)}.${parts.at(-1)}`;
  }
  return id;
}

// String operations, not regexes: model ids come from log files.
export function candidateModelIds(modelId: string): string[] {
  const candidates: string[] = [];
  let id = modelId.trim().toLowerCase();
  const add = (value: string) => {
    if (value && !candidates.includes(value)) {
      candidates.push(value);
    }
  };
  add(id);
  // Step 15.6: a display-style name, "claude sonnet 5.5".
  if (id.includes(" ")) {
    id = id.split(" ").filter((part) => part.length > 0).join("-");
    add(id);
  }
  if (id.includes("/")) {
    id = id.slice(id.lastIndexOf("/") + 1);
    add(id);
  }
  if (id.endsWith("]") && id.lastIndexOf("[") > 0) {
    id = id.slice(0, id.lastIndexOf("["));
    add(id);
  }
  id = withoutDate(id);
  add(id);
  add(dottedVersion(id));
  return candidates;
}

function familyOf(modelId: string): string {
  const dash = modelId.indexOf("-");
  return dash > 0 ? modelId.slice(0, dash) : modelId;
}

export class ProfileVendorResolver implements VendorResolver {
  private readonly vendorByModel = new Map<string, string>();
  private readonly vendorsByFamily = new Map<string, Set<string>>();
  private readonly labels = new Map<string, string>();

  constructor(catalog: readonly VendorCatalogEntry[]) {
    for (const profile of catalog) {
      this.labels.set(profile.vendorId, profile.displayName);
      for (const model of profile.models) {
        const id = model.modelId.toLowerCase();
        this.vendorByModel.set(id, profile.vendorId);
        const family = familyOf(id);
        const vendors = this.vendorsByFamily.get(family) ?? new Set<string>();
        vendors.add(profile.vendorId);
        this.vendorsByFamily.set(family, vendors);
      }
    }
  }

  vendorOf(modelId: string): VendorResolution {
    if (NO_MODEL_IDS.has(modelId.trim().toLowerCase())) {
      return { known: false, reason: "The log records no model for this turn, so its vendor is unknown." };
    }
    if (this.labels.size === 0) {
      return { known: false, reason: "No vendor profiles are loaded, so the model's vendor is unknown." };
    }
    const candidates = candidateModelIds(modelId);
    for (const candidate of candidates) {
      const vendorId = this.vendorByModel.get(candidate);
      if (vendorId) {
        return { known: true, vendorId, basis: "profile" };
      }
    }
    const vendors = this.vendorsByFamily.get(familyOf(candidates.at(-1)!));
    if (vendors?.size === 1) {
      return { known: true, vendorId: [...vendors][0]!, basis: "model-family" };
    }
    return {
      known: false,
      reason: `No vendor profile lists the model ${JSON.stringify(modelId)} or its model family, so its vendor is unknown.`,
    };
  }

  label(vendorId: string): string {
    return this.labels.get(vendorId) ?? vendorId;
  }
}
