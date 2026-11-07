// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { VendorProfile } from "@agent-cost-analyzer/domain";
import { candidateModelIds } from "../cost-attribution/vendor-resolver.js";

// Phase 14 step 14.4 (docs/plans/analyze-session-replay.md §4.3, §12.1):
// a log's model id (Claude Code `claude-opus-5-5`, a release date, a `[1m]`
// tag, a `copilot/` prefix) → the vendor profile model a replay simulates.
// The spellings tried are step 15.4's candidateModelIds (shared, not copied),
// matched case-insensitively against every profile's models; the profile's
// own spelling is returned. No near match is guessed (constraint 6: never a
// made-up model), and a model whose caching is undocumented can't be
// simulated (Phase 13 D1), so it's unknown too.

export type ReplayModelResolution =
  | { known: true; vendorId: string; modelId: string; profile: VendorProfile }
  | { known: false; reason: string };

const NO_MODEL_IDS = new Set(["", "unknown", "<synthetic>"]);
const NO_MODEL_REASON = "The log records no model, so there is none to replay.";

type Entry = { profile: VendorProfile; model: VendorProfile["models"][number] };

export class ReplayModelResolver {
  private readonly byModelId = new Map<string, Entry>();

  constructor(profiles: readonly VendorProfile[]) {
    for (const profile of profiles) {
      for (const model of profile.models) {
        const id = model.modelId.toLowerCase();
        // The first profile to list an id keeps it.
        if (!this.byModelId.has(id)) this.byModelId.set(id, { profile, model });
      }
    }
  }

  resolve(recordedModelId: string): ReplayModelResolution {
    if (NO_MODEL_IDS.has(recordedModelId.trim().toLowerCase())) {
      return { known: false, reason: NO_MODEL_REASON };
    }
    const entry = candidateModelIds(recordedModelId)
      .map((candidate) => this.byModelId.get(candidate))
      .find((found) => found !== undefined);
    if (entry === undefined) {
      return {
        known: false,
        reason: `No vendor profile lists the model ${JSON.stringify(recordedModelId)}, so it can't be replayed.`,
      };
    }
    const { profile, model } = entry;
    const caching = model.cachingKind ?? profile.caching;
    if (caching.kind === "unknown") {
      return {
        known: false,
        reason: `Caching for ${profile.displayName}'s ${model.modelId} is undocumented (${caching.reason}), so it can't be simulated.`,
      };
    }
    return {
      known: true,
      vendorId: profile.vendorId,
      modelId: model.modelId,
      profile,
    };
  }
}
