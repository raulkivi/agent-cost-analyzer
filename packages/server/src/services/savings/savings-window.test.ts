// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { InvalidSavingsWindowError, savingsWindowOf } from "./savings-window.js";

// Phase 16 SR10 (D8): the report's window, 30 days to today by default,
// both ends inclusive; amounts are per week of it.

const NOW = new Date("2026-11-06T23:30:00Z");

describe("savingsWindowOf", () => {
  it("is the last 30 days, today included, by default (D8)", () => {
    expect(savingsWindowOf({}, NOW)).toEqual({ since: "2026-10-08", until: "2026-11-06", days: 30 });
  });

  it("counts both ends of a given range", () => {
    expect(savingsWindowOf({ since: "2026-10-01", until: "2026-10-14" }, NOW)).toEqual({ since: "2026-10-01", until: "2026-10-14", days: 14 });
    expect(savingsWindowOf({ since: "2026-10-01", until: "2026-10-01" }, NOW).days).toBe(1);
  });

  it("runs from a given start to today, or 30 days back from a given end", () => {
    expect(savingsWindowOf({ since: "2026-11-01" }, NOW)).toEqual({ since: "2026-11-01", until: "2026-11-06", days: 6 });
    expect(savingsWindowOf({ until: "2026-10-30" }, NOW)).toEqual({ since: "2026-10-01", until: "2026-10-30", days: 30 });
  });

  it("refuses a start after the end, and anything that isn't a calendar date", () => {
    expect(() => savingsWindowOf({ since: "2026-10-15", until: "2026-10-14" }, NOW)).toThrow(InvalidSavingsWindowError);
    expect(() => savingsWindowOf({ since: "2026-02-30" }, NOW)).toThrow(InvalidSavingsWindowError);
    expect(() => savingsWindowOf({ until: "2026-10-14T10:00:00Z" }, NOW)).toThrow(InvalidSavingsWindowError);
  });
});
