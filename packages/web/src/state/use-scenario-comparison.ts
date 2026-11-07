// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useState } from "react";
import type { VendorComparison } from "@agent-cost-analyzer/domain";
import { compareScenario } from "../api-client/vendor-simulation.js";

export type ComparisonLoad = {
  status: "idle" | "loading" | "ready" | "error";
  comparison: VendorComparison | null;
  error: string | null;
};

const IDLE: ComparisonLoad = { status: "idle", comparison: null, error: null };

// One scenario replayed on several models. `modelIds` undefined asks for
// each vendor's default model; the key makes a new list refetch, and a
// cancelled flag drops an answer that arrives after the session changed.
export function useScenarioComparison(
  sessionId: string | null,
  enabled: boolean,
  modelIds?: string[],
): ComparisonLoad {
  const [load, setLoad] = useState<ComparisonLoad>(IDLE);
  const modelKey = modelIds === undefined ? "" : modelIds.join("\u0000");

  useEffect(() => {
    if (!enabled || sessionId === null) {
      setLoad(IDLE);
      return;
    }
    let cancelled = false;
    setLoad({ status: "loading", comparison: null, error: null });
    void (async () => {
      try {
        const comparison = await compareScenario(sessionId, modelIds);
        if (!cancelled) setLoad({ status: "ready", comparison, error: null });
      } catch (error) {
        if (!cancelled) setLoad({ status: "error", comparison: null, error: (error as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
    // modelKey stands in for the modelIds array's identity.
  }, [sessionId, enabled, modelKey]);

  return load;
}
