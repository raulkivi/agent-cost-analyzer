// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { todayScale, todayStartBefore } from "./today-squeeze.mts";

const MIN = 60_000;

describe("today squeeze", () => {
  it("leaves offsets unchanged when the run is at least the span after midnight", () => {
    const now = new Date(2026, 5, 17, 12, 0, 0);
    expect(todayScale(now, 30 * MIN)).toBe(1);
    expect(todayStartBefore(now, 10 * MIN, 30 * MIN).getTime()).toBe(now.getTime() - 10 * MIN);
  });

  it("squeezes offsets onto today, in order, just after midnight (also on the 1st)", () => {
    const now = new Date(2026, 6, 1, 0, 5, 0);
    const starts = [30, 10, 1].map((minutes) => todayStartBefore(now, minutes * MIN, 30 * MIN));
    for (const start of starts) expect(start.toLocaleDateString("en-CA")).toBe("2026-07-01");
    expect(starts[0]!.getTime()).toBeLessThan(starts[1]!.getTime());
    expect(starts[1]!.getTime()).toBeLessThan(starts[2]!.getTime());
    expect(starts[2]!.getTime()).toBeLessThanOrEqual(now.getTime());
  });
});
