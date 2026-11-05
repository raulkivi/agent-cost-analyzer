import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  vendorProfileSchema,
  type ModelPrice,
  type VendorProfile,
} from "@agent-cost-analyzer/domain";

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

// Fail fast, like the learn-scenario loader: an invalid bundled profile must
// break startup rather than feed wrong prices into a simulation.
export function loadVendorProfiles(dir: string): VendorProfile[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  const profiles: VendorProfile[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(dir, file), "utf-8"),
    );
    const parsed = vendorProfileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Vendor profile "${file}" is invalid: ${parsed.error.message}`,
      );
    }
    const profile = parsed.data;

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
