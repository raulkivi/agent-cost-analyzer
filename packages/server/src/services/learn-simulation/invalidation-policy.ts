// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type {
  ChangeKind,
  Confidence,
  Layer,
  ScriptEvent,
  VendorProfile,
} from "@agent-cost-analyzer/domain";

export interface InvalidationResult {
  // Earliest layer whose cached content no longer matches; unset when none.
  invalidatedFrom?: Layer;
  // At least one applied rule is unknown for this vendor (constraint 6).
  unknown: boolean;
  modelSpecific: boolean;
  confidence: Confidence;
  sourceIds: string[];
  causes: ChangeKind[];
}

const LAYER_ORDER: Layer[] = ["tools", "system", "messages"];
const CONFIDENCE_ORDER: Confidence[] = ["documented", "inferred", "unknown"];

// ScriptEvent types the vendor profile has a rule for (S8-S12).
const PROFILE_CHANGE: Partial<Record<ScriptEvent["type"], ChangeKind>> = {
  "tools-changed": "tools-changed",
  "system-changed": "system-changed",
  "image-added": "image-added",
  "image-removed": "image-removed",
  "thinking-changed": "thinking-changed",
  "model-switch": "model-switch",
};

// Compaction, clear, rewind and fork (S13-S15) behave the same for every
// vendor, so the profile has no rule for them. The simulator sequences
// compaction's warm-prefix read in step 13.5.
const STRUCTURAL: ScriptEvent["type"][] = [
  "compaction",
  "clear",
  "rewind",
  "fork",
];

const weaker = (a: Confidence, b: Confidence): Confidence =>
  CONFIDENCE_ORDER[
    Math.max(CONFIDENCE_ORDER.indexOf(a), CONFIDENCE_ORDER.indexOf(b))
  ]!;

const earlier = (a: Layer | undefined, b: Layer): Layer =>
  a === undefined || LAYER_ORDER.indexOf(b) < LAYER_ORDER.indexOf(a) ? b : a;

export class InvalidationPolicy {
  constructor(private readonly profile: Pick<VendorProfile, "invalidation">) {}

  evaluate(events: ScriptEvent[]): InvalidationResult {
    const result: InvalidationResult = {
      unknown: false,
      modelSpecific: false,
      confidence: "documented",
      sourceIds: [],
      causes: [],
    };

    for (const event of events) {
      if (STRUCTURAL.includes(event.type)) {
        result.invalidatedFrom = earlier(result.invalidatedFrom, "messages");
        result.confidence = weaker(result.confidence, "inferred");
        continue;
      }
      const change = PROFILE_CHANGE[event.type];
      if (change === undefined) continue; // e.g. extended-ttl: no cache effect

      result.causes.push(change);
      const rule = this.profile.invalidation.find((r) => r.change === change);
      if (rule === undefined || rule.invalidatesFrom === "unknown") {
        result.unknown = true;
        result.confidence = "unknown";
        continue;
      }
      result.confidence = weaker(result.confidence, rule.confidence);
      result.modelSpecific ||= rule.modelSpecific === true;
      for (const id of rule.sourceIds) {
        if (!result.sourceIds.includes(id)) result.sourceIds.push(id);
      }
      if (rule.invalidatesFrom !== "nothing") {
        result.invalidatedFrom = earlier(
          result.invalidatedFrom,
          rule.invalidatesFrom,
        );
      }
    }
    return result;
  }
}
