// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { apiMethodResultSchemas, type SessionReplay, type SessionReplayComparison } from "@agent-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

// Phase 14 step 14.5: a real session replayed on other models
// (GET /api/sessions/:id/replay and /replay/compare, or the webview RPC
// methods of the same names). Answers are parsed, so a backend that drifts
// from the domain shapes fails loudly here rather than rendering wrong figures.

export type ReplayPricingRequest = "session-channel" | "copilot" | "api";

export interface SessionReplayQuery {
  model: string;
  pricing?: ReplayPricingRequest;
  provider?: string;
}

export interface SessionReplayComparisonQuery {
  // 1..MAX_COMPARED_MODELS model ids.
  models: string[];
  pricing?: ReplayPricingRequest;
  provider?: string;
}

export async function fetchSessionReplay(sessionId: string, query: SessionReplayQuery, signal?: AbortSignal): Promise<SessionReplay> {
  const answer = await getApiTransport().call("getSessionReplay", { sessionId, ...query }, signal);
  return apiMethodResultSchemas.getSessionReplay.parse(answer);
}

export async function compareSessionReplay(
  sessionId: string,
  query: SessionReplayComparisonQuery,
  signal?: AbortSignal,
): Promise<SessionReplayComparison> {
  const answer = await getApiTransport().call("compareSessionReplay", { sessionId, ...query }, signal);
  return apiMethodResultSchemas.compareSessionReplay.parse(answer);
}
