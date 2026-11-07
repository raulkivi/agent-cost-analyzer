// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useCallback } from "react";
import type { SessionReplayComparison } from "@agent-cost-analyzer/domain";
import { compareSessionReplay, type ReplayPricingRequest } from "../api-client/replay.js";
import { useCancellableLoad } from "../lib/use-cancellable-load.js";

export type ReplayComparisonStatus = "idle" | "loading" | "ready" | "error" | "cancelled";

export interface ReplayComparisonLoad {
  status: ReplayComparisonStatus;
  data: SessionReplayComparison | null;
  // The failure's message as the transport gave it (a 400's or 404's too).
  error: string | null;
  cancel(): void;
  retry(): void;
}

const SEPARATOR = "\u0000";

// Phase 14 step 14.7 (D4): one session's total on several models. A new
// model list or price channel refetches, aborting the request it replaces;
// the key stands in for the array's identity, so an equal list re-rendered
// asks nothing. No models, no request: the route needs at least one.
export function useReplayComparison(
  sessionId: string,
  providerId: string | undefined,
  models: readonly string[],
  pricing: ReplayPricingRequest,
): ReplayComparisonLoad {
  const modelKey = models.join(SEPARATOR);
  const load = useCallback(
    (signal: AbortSignal) =>
      compareSessionReplay(
        sessionId,
        { models: modelKey.split(SEPARATOR), pricing, ...(providerId === undefined ? {} : { provider: providerId }) },
        signal,
      ),
    [sessionId, providerId, modelKey, pricing],
  );
  const enabled = modelKey !== "";
  const { state, cancel, retry } = useCancellableLoad(load, enabled);

  if (!enabled) return { status: "idle", data: null, error: null, cancel, retry };
  switch (state.kind) {
    case "ready":
      return { status: "ready", data: state.data, error: null, cancel, retry };
    case "error":
      return { status: "error", data: null, error: state.message, cancel, retry };
    default:
      return { status: state.kind, data: null, error: null, cancel, retry };
  }
}
