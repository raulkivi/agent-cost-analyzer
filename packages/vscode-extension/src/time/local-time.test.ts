// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { previousDayKey, timeOfDayOf } from "./local-time.js";

describe("previousDayKey", () => {
  it("steps back one calendar day, across month, year and leap-day boundaries", () => {
    expect(previousDayKey("2026-10-24")).toBe("2026-10-23");
    expect(previousDayKey("2026-11-01")).toBe("2026-10-31");
    expect(previousDayKey("2026-01-01")).toBe("2025-12-31");
    expect(previousDayKey("2028-03-01")).toBe("2028-02-29");
  });
});

describe("timeOfDayOf", () => {
  it("is HH:mm on a 24-hour clock in the given time zone", () => {
    expect(timeOfDayOf(new Date("2026-10-24T14:02:00Z"), "UTC")).toBe("14:02");
    expect(timeOfDayOf(new Date("2026-10-24T21:05:00Z"), "Europe/Helsinki")).toBe("00:05");
  });
});
