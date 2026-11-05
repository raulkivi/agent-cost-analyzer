import type { VendorComparisonEntry } from "@agent-cost-analyzer/domain";

export interface EntryStats {
  // null when unknown: an unavailable figure is never shown as 0.
  totalCredits: number | null;
  hitRatio: number | null;
  misses: number;
  mostExpensive: { index: number; credits: number } | null;
}

export type SortKey = "model" | "total" | "usd" | "hit" | "misses" | "expensive";
export type SortDirection = "asc" | "desc";

export function entryStats(entry: VendorComparisonEntry): EntryStats {
  const total = entry.totalAiCredits;
  const knownTurns = entry.turns.filter((turn) => turn.cacheOutcome !== "unknown");
  let mostExpensive: EntryStats["mostExpensive"] = null;
  for (const turn of entry.turns) {
    if (turn.aiCredits.known && (mostExpensive === null || turn.aiCredits.value > mostExpensive.credits)) {
      mostExpensive = { index: turn.index, credits: turn.aiCredits.value };
    }
  }
  return {
    totalCredits: total?.known ? total.value : null,
    hitRatio:
      knownTurns.length === 0 ? null : knownTurns.filter((turn) => turn.cacheOutcome === "hit").length / knownTurns.length,
    misses: entry.turns.filter((turn) => turn.cacheOutcome === "miss").length,
    mostExpensive,
  };
}

function sortValue(entry: VendorComparisonEntry, key: SortKey): string | number | null {
  const stats = entryStats(entry);
  switch (key) {
    case "model":
      return entry.displayName.toLowerCase();
    case "total":
    case "usd":
      return stats.totalCredits;
    case "hit":
      return stats.hitRatio;
    case "misses":
      return stats.misses;
    case "expensive":
      return stats.mostExpensive?.credits ?? null;
  }
}

// Unavailable values sort last in both directions, so they never read as the
// cheapest or the best.
export function sortEntries(
  entries: VendorComparisonEntry[],
  key: SortKey,
  direction: SortDirection,
): VendorComparisonEntry[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...entries].sort((left, right) => {
    const a = sortValue(left, key);
    const b = sortValue(right, key);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -sign : a > b ? sign : 0;
  });
}
