import type { Session } from "@agent-cost-analyzer/domain";

// What ApiService's Learn list and lookup read from; the simulated catalog
// (simulated-scenario-catalog.ts) is its only implementation.
export interface LearnScenarioCatalog {
  list(): Session[];
  get(id: string): Session | undefined;
}
