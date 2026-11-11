// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { AUDIT_POLL_INTERVAL_MS, AUDIT_POLL_LIMIT_MS, pollUntil } from "./poll-until.mts";

// A fake clock: sleeping advances it, so no test waits for real.
function clock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

describe("pollUntil (wait for Copilot's debug log to catch up, no fixed sleeps)", () => {
  it("polls every 2 s for up to 90 s", () => {
    expect(AUDIT_POLL_INTERVAL_MS).toBe(2_000);
    expect(AUDIT_POLL_LIMIT_MS).toBe(90_000);
  });

  it("returns at once, without sleeping, when the first read satisfies", async () => {
    const c = clock();
    const result = await pollUntil({ read: async () => 1, isSatisfied: (v) => v === 1, intervalMs: 2_000, timeoutMs: 90_000, ...c });
    expect(result).toEqual({ value: 1, satisfied: true });
    expect(c.sleeps).toEqual([]);
  });

  it("is satisfied on a later poll and never waits after the predicate holds", async () => {
    const c = clock();
    let reads = 0;
    const result = await pollUntil({ read: async () => ++reads, isSatisfied: (v) => v >= 3, intervalMs: 2_000, timeoutMs: 90_000, ...c });
    expect(result).toEqual({ value: 3, satisfied: true });
    expect(reads).toBe(3);
    expect(c.sleeps).toEqual([2_000, 2_000]);
  });

  it("gives up at the timeout with the last value read", async () => {
    const c = clock();
    let reads = 0;
    const result = await pollUntil({ read: async () => ++reads, isSatisfied: () => false, intervalMs: 2_000, timeoutMs: 6_000, ...c });
    expect(result).toEqual({ value: 4, satisfied: false });
    expect(c.now()).toBe(6_000);
  });

  it("does not sleep past the deadline when the interval does not divide the timeout", async () => {
    const c = clock();
    await pollUntil({ read: async () => 0, isSatisfied: () => false, intervalMs: 4_000, timeoutMs: 6_000, ...c });
    expect(c.sleeps).toEqual([4_000, 2_000]);
  });

  it("rethrows a reader error at once: a failed tool call is not a slow log", async () => {
    const c = clock();
    const read = async (): Promise<number> => {
      throw new Error("list_tool_calls failed");
    };
    await expect(pollUntil({ read, isSatisfied: () => true, intervalMs: 2_000, timeoutMs: 90_000, ...c })).rejects.toThrow("list_tool_calls failed");
    expect(c.sleeps).toEqual([]);
  });
});
