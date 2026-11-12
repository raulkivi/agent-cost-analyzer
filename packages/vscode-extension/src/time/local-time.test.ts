// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { dayKeyOf, dayStartInstant, previousDayKey, timeOfDayOf } from "./local-time.js";

describe("dayKeyOf", () => {
  it("is the calendar date in the given time zone", () => {
    const instant = new Date("2026-10-24T23:30:00Z");

    expect(dayKeyOf(instant, "UTC")).toBe("2026-10-24");
    expect(dayKeyOf(instant, "Europe/Helsinki")).toBe("2026-10-25"); // UTC+3 in October
    expect(dayKeyOf(instant, "America/Los_Angeles")).toBe("2026-10-24");
  });

  it("changes exactly at local midnight", () => {
    expect(dayKeyOf(new Date("2026-10-24T20:59:59Z"), "Europe/Helsinki")).toBe("2026-10-24");
    expect(dayKeyOf(new Date("2026-10-24T21:00:00Z"), "Europe/Helsinki")).toBe("2026-10-25");
  });

  it("pads month and day", () => {
    expect(dayKeyOf(new Date("2026-01-02T12:00:00Z"), "UTC")).toBe("2026-01-02");
  });

  it("uses the machine's own zone when none is given", () => {
    const instant = new Date("2026-06-15T12:00:00Z");

    expect(dayKeyOf(instant)).toMatch(/^2026-06-1[456]$/);
  });
});

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

describe("dayStartInstant", () => {
  const zones = ["UTC", "Europe/Tallinn", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Auckland"];
  // Around DST changes in the northern and the southern zones.
  const days = ["2026-03-29", "2026-03-30", "2026-10-25", "2026-11-01", "2026-04-05", "2026-09-27", "2026-12-31", "2027-01-01"];

  it.each(zones)("is the first instant of the local day in %s, to the millisecond", (zone) => {
    for (const day of days) {
      const start = dayStartInstant(day, zone);

      expect(dayKeyOf(new Date(start), zone)).toBe(day);
      expect(dayKeyOf(new Date(start - 1), zone) < day).toBe(true);
    }
  });

  it("is midnight UTC for UTC", () => {
    expect(dayStartInstant("2026-10-24", "UTC")).toBe(Date.parse("2026-10-24T00:00:00Z"));
  });

  it("is the start of the local day in Helsinki (UTC+3 in October)", () => {
    expect(dayStartInstant("2026-10-24", "Europe/Helsinki")).toBe(Date.parse("2026-10-23T21:00:00Z"));
  });
});
