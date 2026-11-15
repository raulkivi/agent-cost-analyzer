// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { dayKeyOf, dayStartInstant } from "./day-key.js";

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

  it("follows offsets that are not whole hours and the extremes of +14 and -11", () => {
    const instant = new Date("2026-10-31T18:20:00Z");

    expect(dayKeyOf(instant, "Asia/Kolkata")).toBe("2026-10-31"); // 23:50, UTC+5:30
    expect(dayKeyOf(instant, "Asia/Kathmandu")).toBe("2026-11-01"); // 00:05, UTC+5:45
    expect(dayKeyOf(new Date("2026-10-31T10:00:00Z"), "Pacific/Kiritimati")).toBe("2026-11-01");
    expect(dayKeyOf(new Date("2026-11-01T10:59:59Z"), "Pacific/Pago_Pago")).toBe("2026-10-31");
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

  // Where daylight saving starts at midnight, 00:00 never happens and the
  // day starts at 01:00.
  it.each([
    ["America/Santiago", "2026-09-06", "2026-09-06T04:00:00Z"],
    ["Asia/Beirut", "2026-03-29", "2026-03-28T22:00:00Z"],
    ["America/Havana", "2026-03-08", "2026-03-08T05:00:00Z"],
  ])("is 01:00 on a day whose midnight is skipped (%s, %s)", (zone, day, expected) => {
    const start = dayStartInstant(day, zone);

    expect(start).toBe(Date.parse(expected));
    expect(dayKeyOf(new Date(start - 1), zone)).not.toBe(day);
  });

  it.each([
    ["Australia/Lord_Howe", "2026-10-04", "2026-10-03T13:30:00Z"], // 30-minute DST shift
    ["Asia/Kathmandu", "2026-11-01", "2026-10-31T18:15:00Z"],
    ["Pacific/Kiritimati", "2026-11-01", "2026-10-31T10:00:00Z"],
    ["Pacific/Pago_Pago", "2026-11-01", "2026-11-01T11:00:00Z"],
  ])("finds the day's start in %s on %s despite an odd or extreme offset", (zone, day, expected) => {
    expect(dayStartInstant(day, zone)).toBe(Date.parse(expected));
  });
});
