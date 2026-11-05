import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  modelPriceSchema,
  vendorProfileSchema,
  type ModelPrice,
  type PriceVersion,
  type VendorProfile,
} from "@agent-cost-analyzer/domain";
import { BundledPriceBookSource } from "../../services/pricing/bundled-price-book-source.js";
import { PriceBook } from "../../services/pricing/price-book.js";

// Phase 15 step 15.5 (cost-by-repository-and-project.md §6.1): a profile's
// prices are GitHub's Copilot table, which now lives in the price book; a
// model takes its tiers (and promoEndsAt) from the book's newest
// github-copilot version. A profile file may still carry its own tiers
// for a model the book doesn't price (test data).
export const PROFILE_PRICE_CHANNEL = "github-copilot";

export interface CurrentPrices {
  newestVersion(channel: string, modelId: string): Pick<PriceVersion, "tiers" | "promoEndsAt"> | undefined;
}

const profileFileSchema = vendorProfileSchema.extend({
  models: z.array(modelPriceSchema.extend({ tiers: modelPriceSchema.shape.tiers.optional() })),
});
type ProfileFile = z.infer<typeof profileFileSchema>;

const NO_PRICES: CurrentPrices = { newestVersion: () => undefined };

// The bundled layout keeps fixtures/price-book beside fixtures/vendor-profiles,
// and the extension copies both into media/ the same way.
function pricesBeside(profilesDir: string): CurrentPrices {
  const bookDir = path.join(profilesDir, "..", "price-book");
  return existsSync(bookDir) ? new PriceBook(new BundledPriceBookSource(bookDir)) : NO_PRICES;
}

function withPrices(file: string, raw: ProfileFile, prices: CurrentPrices): VendorProfile {
  const models = raw.models.map(({ tiers, promoEndsAt, ...model }): ModelPrice => {
    const newest = prices.newestVersion(PROFILE_PRICE_CHANNEL, model.modelId);
    if (newest !== undefined && tiers !== undefined) {
      throw new Error(`Vendor profile "${file}": model "${model.modelId}" has tiers of its own, but its prices belong in the price book`);
    }
    if (newest === undefined && tiers === undefined) {
      throw new Error(`Vendor profile "${file}": model "${model.modelId}" has no ${PROFILE_PRICE_CHANNEL} price in the price book`);
    }
    const priced = newest ?? { tiers: tiers!, promoEndsAt };
    const { modelId, displayName, vendorId, releaseStatus, ...rest } = model;
    return {
      modelId,
      displayName,
      vendorId,
      releaseStatus,
      tiers: priced.tiers,
      ...rest,
      ...(priced.promoEndsAt !== undefined ? { promoEndsAt: priced.promoEndsAt } : {}),
    };
  });
  return { ...raw, models };
}

// Cross-reference rules the zod schema can't express. Returns the first
// problem found, or undefined when the profile is consistent.
function findReferenceProblem(profile: VendorProfile): string | undefined {
  const modelIds = new Set(profile.models.map((model) => model.modelId));
  const sourceIds = new Set(profile.sources.map((source) => source.id));
  const unknownSource = (ids: string[] | undefined): string | undefined =>
    ids?.find((id) => !sourceIds.has(id));

  if (!modelIds.has(profile.defaultModelId)) {
    return `defaultModelId "${profile.defaultModelId}" is not among the models`;
  }
  for (const model of profile.models) {
    if (
      model.cheaperSiblingId !== undefined &&
      !modelIds.has(model.cheaperSiblingId)
    ) {
      return `model "${model.modelId}" has cheaperSiblingId "${model.cheaperSiblingId}" that is not among the models`;
    }
    if (model.sourceIds.length === 0) {
      return `model "${model.modelId}" has no sourceIds`;
    }
    const missing = unknownSource(model.sourceIds);
    if (missing !== undefined) {
      return `model "${model.modelId}" cites unknown source "${missing}"`;
    }
  }
  for (const rule of profile.invalidation) {
    const missing = unknownSource(rule.sourceIds);
    if (missing !== undefined) {
      return `invalidation rule "${rule.change}" cites unknown source "${missing}"`;
    }
  }
  for (const assumption of profile.assumptions) {
    const missing = unknownSource(assumption.sourceIds);
    if (missing !== undefined) {
      return `assumption "${assumption.text}" cites unknown source "${missing}"`;
    }
  }
  return undefined;
}

// Resolved lazily: a single-file bundle passes its own directory instead (G4).
function defaultProfilesDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/vendor-profiles",
  );
}

// Fail fast, like the learn-scenario loader: an invalid bundled profile must
// break startup rather than feed wrong prices into a simulation.
export function loadVendorProfiles(dir: string = defaultProfilesDir(), prices: CurrentPrices = pricesBeside(dir)): VendorProfile[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  const profiles: VendorProfile[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(dir, file), "utf-8"),
    );
    const parsed = profileFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Vendor profile "${file}" is invalid: ${parsed.error.message}`,
      );
    }
    const profile = withPrices(file, parsed.data, prices);

    const firstFile = seen.get(profile.vendorId);
    if (firstFile !== undefined) {
      throw new Error(
        `Vendor profile "${file}": duplicate vendorId "${profile.vendorId}" (also in "${firstFile}")`,
      );
    }
    seen.set(profile.vendorId, file);

    const problem = findReferenceProblem(profile);
    if (problem !== undefined) {
      throw new Error(`Vendor profile "${file}": ${problem}`);
    }
    profiles.push(profile);
  }

  return profiles;
}

export function findVendorModel(
  profiles: VendorProfile[],
  modelId: string,
): { profile: VendorProfile; model: ModelPrice } | undefined {
  for (const profile of profiles) {
    const model = profile.models.find(
      (candidate) => candidate.modelId === modelId,
    );
    if (model !== undefined) return { profile, model };
  }
  return undefined;
}
