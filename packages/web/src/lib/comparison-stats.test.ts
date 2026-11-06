import { describe, expect, it } from "vitest";
import type { VendorComparisonEntry } from "@agent-cost-analyzer/domain";
import { entryStats, sortEntries } from "./comparison-stats.js";

const turn = (index: number, cacheOutcome: "hit" | "partial" | "miss" | "unknown", credits: number | null) => ({
  index,
  cacheOutcome,
  aiCredits: credits === null ? { known: false as const, reason: "x" } : { known: true as const, value: credits },
  note: "n",
  sourceIds: [],
});

const entry = (
  modelId: string,
  turns: ReturnType<typeof turn>[],
  total: number | null,
): VendorComparisonEntry => ({
  vendorId: "v",
  modelId,
  displayName: modelId,
  simulated: true,
  totalAiCredits: total === null ? { known: false, reason: "x" } : { known: true, value: total },
  turns,
});

describe("entryStats", () => {
  it("counts hit ratio over known turns, misses and the most expensive turn", () => {
    const stats = entryStats(
      entry("m", [turn(1, "miss", 1), turn(2, "hit", 0.5), turn(3, "partial", 2), turn(4, "unknown", null)], 3.5),
    );
    expect(stats).toEqual({
      totalCredits: 3.5,
      hitRatio: 1 / 3,
      misses: 1,
      mostExpensive: { index: 3, credits: 2 },
    });
  });

  it("is unavailable, never zero, when nothing is known", () => {
    const stats = entryStats(entry("m", [turn(1, "unknown", null)], null));
    expect(stats).toEqual({ totalCredits: null, hitRatio: null, misses: 0, mostExpensive: null });
  });

  it("is unavailable for an entry that is not simulated", () => {
    const stats = entryStats({
      vendorId: "v",
      modelId: "m",
      displayName: "m",
      simulated: false,
      reason: "no",
      turns: [],
    });
    expect(stats.totalCredits).toBeNull();
    expect(stats.hitRatio).toBeNull();
  });
});

describe("sortEntries", () => {
  const a = entry("a", [turn(1, "hit", 1)], 5);
  const b = entry("b", [turn(1, "miss", 3)], 1);
  const c = entry("c", [turn(1, "unknown", null)], null);

  it("sorts by total credits ascending and descending, unavailable last", () => {
    expect(sortEntries([a, c, b], "total", "asc").map((e) => e.modelId)).toEqual(["b", "a", "c"]);
    expect(sortEntries([a, c, b], "total", "desc").map((e) => e.modelId)).toEqual(["a", "b", "c"]);
  });

  it("sorts by model name", () => {
    expect(sortEntries([b, c, a], "model", "asc").map((e) => e.modelId)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const input = [b, a];
    sortEntries(input, "model", "asc");
    expect(input.map((e) => e.modelId)).toEqual(["b", "a"]);
  });
});
