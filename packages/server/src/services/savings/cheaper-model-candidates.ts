// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { VendorProfile } from "@agent-cost-analyzer/domain";
import { ReplayModelResolver } from "../session-replay/replay-model-resolver.js";
import { MAX_CHEAPER_MODELS, type CheaperModelCandidates } from "./detectors/cheaper-model-detector.js";

// Phase 16 SR8 (D5): the vendor profile's own word on what is cheaper. Each
// model may name a cheaper sibling; the chain from the session's model is the
// candidate list, so no model of another vendor and no price is guessed. A
// sibling that would not really cost less shows up in the replay (its
// simulated cost is not lower) and is left out of the report there.
export class ProfileCheaperModels implements CheaperModelCandidates {
  private readonly resolver: ReplayModelResolver;

  constructor(profiles: readonly VendorProfile[]) {
    this.resolver = new ReplayModelResolver(profiles);
  }

  candidatesFor(model: string): readonly string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current = this.resolver.findModel(model);
    while (current !== undefined && chain.length < MAX_CHEAPER_MODELS) {
      seen.add(current.model.modelId.toLowerCase());
      const siblingId = current.model.cheaperSiblingId;
      if (siblingId === undefined || seen.has(siblingId.toLowerCase())) break;
      // Same vendor: the sibling is looked up in the model's own profile.
      const sibling = current.profile.models.find((candidate) => candidate.modelId.toLowerCase() === siblingId.toLowerCase());
      if (sibling === undefined) break;
      chain.push(sibling.modelId);
      current = { profile: current.profile, model: sibling };
    }
    return chain;
  }
}
