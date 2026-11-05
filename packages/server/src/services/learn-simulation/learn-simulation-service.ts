import {
  sumTokenCounts,
  type Harness,
  type ModelPrice,
  type ScenarioScript,
  type Session,
  type VendorComparison,
  type VendorComparisonEntry,
  type VendorProfile,
  type VendorProfileSummary,
} from "@agent-cost-analyzer/domain";
import { NoCheaperModelError, simulateScenario } from "./simulate-scenario.js";

export class ScenarioNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown learn scenario id "${id}"`);
    this.name = "ScenarioNotFoundError";
  }
}

export class UnknownModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownModelError";
  }
}

const NOT_SIMULATED = "Not simulated: caching behaviour isn't documented";
const TOTAL_UNKNOWN = "At least one turn's cost is unknown for this vendor.";
const DEFAULT_VENDOR_ID = "anthropic";

// A model's own caching kind overrides its vendor's default (e.g. GPT-5.6+).
const isSimulated = (profile: VendorProfile, model: ModelPrice): boolean =>
  (model.cachingKind ?? profile.caching).kind !== "unknown";

// The ApiService's view of the simulator (step 13.6): scripts and vendor
// profiles are loaded once by the composition root and injected, so this
// never touches the filesystem (DIP).
export class LearnSimulationService {
  constructor(
    private readonly scripts: ScenarioScript[],
    private readonly profiles: VendorProfile[],
    private readonly harness: Harness,
  ) {}

  getScenario(id: string, modelId?: string): Session {
    const script = this.findScript(id);
    const { profile, model } = this.resolveModel(
      modelId ?? this.defaultModelId(),
    );
    if (!isSimulated(profile, model)) {
      throw new UnknownModelError(`${model.displayName}: ${NOT_SIMULATED}`);
    }
    return simulateScenario(script, {
      profile,
      modelId: model.modelId,
      harness: this.harness,
    });
  }

  compareScenario(id: string, modelIds?: string[]): VendorComparison {
    const script = this.findScript(id);
    const ids =
      modelIds ?? this.simulatedProfiles().map((p) => p.defaultModelId);
    const entries = ids.map((modelId) => this.compareOne(script, modelId));
    return { scenarioId: id, entries };
  }

  listVendorProfiles(): VendorProfileSummary[] {
    return this.profiles.map((profile) => ({
      vendorId: profile.vendorId,
      displayName: profile.displayName,
      defaultModelId: profile.defaultModelId,
      models: profile.models.map((model) =>
        isSimulated(profile, model)
          ? {
              modelId: model.modelId,
              displayName: model.displayName,
              simulated: true,
            }
          : {
              modelId: model.modelId,
              displayName: model.displayName,
              simulated: false,
              reason: NOT_SIMULATED,
            },
      ),
      assumptions: profile.assumptions,
      sources: profile.sources,
      // ISO dates sort lexically, so the minimum is the oldest check.
      oldestCheckedAt: profile.sources.map((s) => s.checkedAt).sort()[0] ?? "",
    }));
  }

  private compareOne(
    script: ScenarioScript,
    modelId: string,
  ): VendorComparisonEntry {
    const { profile, model } = this.resolveModel(modelId);
    const base = {
      vendorId: profile.vendorId,
      modelId: model.modelId,
      displayName: model.displayName,
    };
    if (!isSimulated(profile, model)) {
      return { ...base, simulated: false, reason: NOT_SIMULATED, turns: [] };
    }
    try {
      const session = simulateScenario(script, {
        profile,
        modelId,
        harness: this.harness,
      });
      return {
        ...base,
        simulated: true,
        totalAiCredits: sumTokenCounts(
          session.turns.map((t) => t.usage.costAiCredits),
          TOTAL_UNKNOWN,
        ),
        turns: session.turns.map((turn) => ({
          index: turn.index,
          cacheOutcome: turn.simulation!.cacheOutcome,
          aiCredits: turn.usage.costAiCredits,
          note: turn.simulation!.note,
          sourceIds: turn.simulation!.sourceIds,
        })),
      };
    } catch (error) {
      if (error instanceof NoCheaperModelError) {
        return {
          ...base,
          simulated: false,
          reason:
            "No cheaper model is curated for this vendor, so this scenario can't be simulated.",
          turns: [],
        };
      }
      throw error;
    }
  }

  private findScript(id: string): ScenarioScript {
    const script = this.scripts.find((s) => s.id === id);
    if (script === undefined || !script.harnesses.includes(this.harness)) {
      throw new ScenarioNotFoundError(id);
    }
    return script;
  }

  private resolveModel(modelId: string): {
    profile: VendorProfile;
    model: ModelPrice;
  } {
    for (const profile of this.profiles) {
      const model = profile.models.find((m) => m.modelId === modelId);
      if (model !== undefined) return { profile, model };
    }
    throw new UnknownModelError(`Unknown model id "${modelId}"`);
  }

  private simulatedProfiles(): VendorProfile[] {
    return this.profiles.filter(
      (p) =>
        p.caching.kind !== "unknown" || p.models.some((m) => isSimulated(p, m)),
    );
  }

  private defaultModelId(): string {
    const preferred = this.profiles.find(
      (p) => p.vendorId === DEFAULT_VENDOR_ID,
    );
    return (preferred ?? this.simulatedProfiles()[0] ?? this.profiles[0]!)
      .defaultModelId;
  }
}
