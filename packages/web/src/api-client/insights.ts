import type { InsightsDataset } from "@copilot-cost-analyzer/domain";
import { getJson } from "./http.js";

export interface InsightsQuery {
  since?: string;
  until?: string;
  limit?: number; // per provider
}

export function fetchInsights(query: InsightsQuery): Promise<InsightsDataset> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return getJson<InsightsDataset>(search ? `/api/insights?${search}` : "/api/insights");
}
