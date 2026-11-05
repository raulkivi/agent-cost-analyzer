import type { PriceBookEntry, PriceBookProblem, Source } from "@agent-cost-analyzer/domain";

// Phase 15 step 15.5 (docs/plans/cost-by-repository-and-project.md §9): where
// price versions come from. Every source returns validated versions marked
// with their origin (Liskov); the composite only combines them.
export interface PriceBookData {
  versions: PriceBookEntry[];
  // The sources the versions cite, each with checkedAt.
  sources: Source[];
  // Versions a source left out, and why (user data only; bundled data that
  // fails a check stops startup instead).
  problems: PriceBookProblem[];
}

export interface PriceBookSource {
  load(): PriceBookData;
}
