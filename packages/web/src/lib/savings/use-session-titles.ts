// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useMemo, useState } from "react";
import type { InsightsDataset } from "@agent-cost-analyzer/domain";
import type { InsightsQuery } from "../../api-client/insights.js";
import { sessionTitleLookup, type SessionTitleOf } from "./session-titles.js";

// The Dashboard's own cap per provider, so the titles are the dataset it shows.
const SESSIONS_PER_PROVIDER = 200;

// V25 (D24, D25): the insights dataset over the report's window, loaded once
// `enabled` turns true (a detail opened) and kept. A failed or canceled load
// leaves the lookup empty, so the list shows ids alone and says nothing: a
// title is a convenience, never a reason to show an error.
export function useSessionTitles(
  loadInsights: (query: InsightsQuery, signal: AbortSignal) => Promise<InsightsDataset>,
  window: { since: string; until: string },
  enabled: boolean,
): SessionTitleOf {
  const [dataset, setDataset] = useState<InsightsDataset | undefined>(undefined);
  const { since, until } = window;

  useEffect(() => {
    setDataset(undefined);
  }, [since, until]);

  useEffect(() => {
    if (!enabled || dataset !== undefined) return;
    const controller = new AbortController();
    loadInsights({ since, until, limit: SESSIONS_PER_PROVIDER }, controller.signal).then(
      (loaded) => {
        if (!controller.signal.aborted) setDataset(loaded);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [enabled, dataset, loadInsights, since, until]);

  return useMemo(() => sessionTitleLookup(dataset?.sessions), [dataset]);
}
