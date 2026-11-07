// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { VendorProfileSummary } from "@agent-cost-analyzer/domain";

const FALLBACK_MODEL_ID = "claude-sonnet-5.5";

// D3: the simulated model the user's recent Analyze sessions used most;
// Claude Sonnet 5.5 when none matches (or the first simulated model if the
// profiles don't include it).
export function defaultSimulatedModel(
  sessions: { model: string }[],
  profiles: VendorProfileSummary[],
): string {
  const simulated = profiles.flatMap((profile) => profile.models).filter((model) => model.simulated);
  const byName = new Map<string, string>();
  for (const model of simulated) {
    byName.set(model.modelId.toLowerCase(), model.modelId);
    byName.set(model.displayName.toLowerCase(), model.modelId);
  }
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const modelId = byName.get(session.model.toLowerCase());
    if (modelId !== undefined) counts.set(modelId, (counts.get(modelId) ?? 0) + 1);
  }
  let best: string | undefined;
  for (const [modelId, count] of counts) {
    if (best === undefined || count > counts.get(best)!) best = modelId;
  }
  if (best !== undefined) return best;
  return simulated.some((model) => model.modelId === FALLBACK_MODEL_ID)
    ? FALLBACK_MODEL_ID
    : (simulated[0]?.modelId ?? FALLBACK_MODEL_ID);
}
