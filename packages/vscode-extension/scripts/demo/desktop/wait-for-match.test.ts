// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { waitForGone, waitForMatch, type Clock } from "./wait-for-match.mts";

const match = { x: 1, y: 2, width: 3, height: 4, score: 0.97 };

function fakeClock(): Clock & { slept: number[] } {
  let t = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms);
      t += ms;
    },
  };
}

describe("waitForMatch", () => {
  it("returns the first match, polling at the interval", async () => {
    const clock = fakeClock();
    let calls = 0;
    const probe = async () => (++calls === 3 ? match : undefined);
    await expect(waitForMatch("stop", probe, { timeoutMs: 5000, intervalMs: 100 }, clock)).resolves.toEqual(match);
    expect(clock.slept).toEqual([100, 100]);
  });
  it("rejects naming the template once the timeout passes", async () => {
    const clock = fakeClock();
    await expect(waitForMatch("expand", async () => undefined, { timeoutMs: 300, intervalMs: 100 }, clock)).rejects.toThrow(
      /expand.*300 ms/,
    );
  });
});

describe("waitForGone", () => {
  it("resolves when the probe stops matching", async () => {
    const clock = fakeClock();
    let calls = 0;
    const probe = async () => (++calls < 3 ? match : undefined);
    await expect(waitForGone("stop", probe, { timeoutMs: 5000, intervalMs: 50 }, clock)).resolves.toBeUndefined();
    expect(clock.slept).toEqual([50, 50, 50]);
  });
  it("rejects naming the template while it stays on screen", async () => {
    const clock = fakeClock();
    await expect(waitForGone("stop", async () => match, { timeoutMs: 200, intervalMs: 100 }, clock)).rejects.toThrow(/stop.*still/);
  });
});
