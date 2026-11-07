// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { MAX_COMPARED_MODELS, type VendorProfileSummary } from "@agent-cost-analyzer/domain";

// Phase 14 step 14.7: which models a session can be replayed on, and which
// the Compare models view starts with.

// D1 (plan §11): Claude Code and Copilot (both harnesses) read request
// traces; pi and mitmproxy follow. The wording is the API's own 404 reason
// (SessionReplayService's NOT_REPLAYABLE_PROVIDER_REASON), so the picker and
// a refused request say the same thing.
export const NOT_REPLAYABLE_PROVIDER_REASON = "This provider's logs can't be replayed yet.";
const REPLAYABLE_PROVIDERS = new Set(["claude-code", "vscode"]);

export function replayUnavailableReason(providerId: string | undefined): string | undefined {
  return providerId !== undefined && REPLAYABLE_PROVIDERS.has(providerId) ? undefined : NOT_REPLAYABLE_PROVIDER_REASON;
}

// A log's spelling of a model id (claude-opus-5-5, a date suffix, [1m],
// copilot/) in the vendor profiles' spelling. Only exact matches after that
// count: no near match is guessed, as the server's resolver does.
function canonical(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/^copilot\//, "")
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{8}$/, "")
    .replace(/\./g, "-");
}

const simulatedModels = (profiles: readonly VendorProfileSummary[]) =>
  profiles.flatMap((profile) => profile.models.filter((model) => model.simulated).map((model) => model.modelId));

// The profile model a log's model id names, if any profile simulates it.
export function profileModelIdFor(logModelId: string, profiles: readonly VendorProfileSummary[]): string | undefined {
  const wanted = canonical(logModelId);
  return simulatedModels(profiles).find((modelId) => canonical(modelId) === wanted);
}

// The chosen replay model, the session's own and each vendor's default
// model, deduped and within the cap. The server always compares the
// session's own model, so when it has no profile here a slot is kept for it.
export function initialCompareModels({
  replayModel,
  sessionModel,
  profiles,
}: {
  replayModel: string | null;
  sessionModel: string;
  profiles: readonly VendorProfileSummary[];
}): string[] {
  const simulated = new Set(simulatedModels(profiles));
  const own = profileModelIdFor(sessionModel, profiles);
  const defaults = profiles.map((profile) => profile.defaultModelId).filter((modelId) => simulated.has(modelId));
  const candidates = [...(replayModel ? [replayModel] : []), ...(own ? [own] : []), ...defaults];
  const cap = own ? MAX_COMPARED_MODELS : MAX_COMPARED_MODELS - 1;
  return [...new Set(candidates)].slice(0, cap);
}
