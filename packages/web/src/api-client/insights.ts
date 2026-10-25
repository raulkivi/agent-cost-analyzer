import type { InsightsDataset } from "@agent-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

export interface InsightsQuery {
  since?: string;
  until?: string;
  limit?: number; // per provider
}

// Unset / empty filters are dropped by the transport. `signal` cancels the load.
export function fetchInsights(query: InsightsQuery, signal?: AbortSignal): Promise<InsightsDataset> {
  return getApiTransport().call<InsightsDataset>("getInsights", query, signal);
}
