// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { periodOf } from "./billing-period.js";

const at = (iso: string, timeZone = "UTC", resetDay = 1) => periodOf(new Date(iso), timeZone, resetDay);

describe("periodOf", () => {
  it("is the calendar month for reset day 1", () => {
    expect(at("2026-11-12T10:00:00Z")).toEqual({ startKey: "2026-11-01", endKeyExclusive: "2026-12-01", daysLeft: 19, dayOfPeriod: 12 });
  });

  it("starts in the previous month before the reset day", () => {
    expect(at("2026-11-12T10:00:00Z", "UTC", 15)).toEqual({ startKey: "2026-10-15", endKeyExclusive: "2026-11-15", daysLeft: 3, dayOfPeriod: 29 });
  });

  it("starts in this month on and after the reset day", () => {
    expect(at("2026-11-15T10:00:00Z", "UTC", 15)).toEqual({ startKey: "2026-11-15", endKeyExclusive: "2026-12-15", daysLeft: 30, dayOfPeriod: 1 });
    expect(at("2026-11-20T10:00:00Z", "UTC", 15).startKey).toBe("2026-11-15");
  });

  it("counts days left inclusive of today: first day is the whole period, last day is 1", () => {
    expect(at("2026-11-01T00:00:00Z").daysLeft).toBe(30);
    expect(at("2026-11-30T23:59:59Z").daysLeft).toBe(1);
    expect(at("2026-11-14T12:00:00Z", "UTC", 15).daysLeft).toBe(1);
  });

  it("crosses the year boundary both ways", () => {
    expect(at("2027-01-05T10:00:00Z", "UTC", 10)).toMatchObject({ startKey: "2026-12-10", endKeyExclusive: "2027-01-10" });
    expect(at("2026-12-20T10:00:00Z", "UTC", 10)).toMatchObject({ startKey: "2026-12-10", endKeyExclusive: "2027-01-10" });
    expect(at("2026-12-31T10:00:00Z")).toMatchObject({ startKey: "2026-12-01", endKeyExclusive: "2027-01-01", daysLeft: 1 });
  });

  it("handles February in common and leap years, including reset day 28", () => {
    expect(at("2026-02-10T10:00:00Z")).toMatchObject({ startKey: "2026-02-01", endKeyExclusive: "2026-03-01", daysLeft: 19 });
    expect(at("2028-02-10T10:00:00Z")).toMatchObject({ startKey: "2028-02-01", endKeyExclusive: "2028-03-01", daysLeft: 20 });
    expect(at("2026-03-05T10:00:00Z", "UTC", 28)).toMatchObject({ startKey: "2026-02-28", endKeyExclusive: "2026-03-28", daysLeft: 23 });
    expect(at("2028-03-05T10:00:00Z", "UTC", 28)).toMatchObject({ startKey: "2028-02-28", endKeyExclusive: "2028-03-28", daysLeft: 23 });
    expect(at("2026-02-27T10:00:00Z", "UTC", 28)).toMatchObject({ startKey: "2026-01-28", endKeyExclusive: "2026-02-28", daysLeft: 1 });
  });

  it("judges the day in the given time zone", () => {
    const instant = "2026-11-30T23:30:00Z";

    expect(at(instant, "UTC")).toMatchObject({ startKey: "2026-11-01", daysLeft: 1 });
    expect(at(instant, "Europe/Helsinki")).toMatchObject({ startKey: "2026-12-01", endKeyExclusive: "2027-01-01", daysLeft: 31, dayOfPeriod: 1 });
    expect(at("2026-12-01T03:00:00Z", "America/Los_Angeles")).toMatchObject({ startKey: "2026-11-01", daysLeft: 1 });
  });

  it("is not thrown off by daylight-saving changes inside the period", () => {
    // Europe/Helsinki: clocks go back 2026-10-25, forward 2026-03-29.
    expect(at("2026-10-31T22:30:00Z", "Europe/Helsinki")).toMatchObject({ startKey: "2026-11-01", endKeyExclusive: "2026-12-01", daysLeft: 30 });
    expect(at("2026-10-25T12:00:00Z", "Europe/Helsinki")).toMatchObject({ startKey: "2026-10-01", endKeyExclusive: "2026-11-01", daysLeft: 7, dayOfPeriod: 25 });
    expect(at("2026-03-29T12:00:00Z", "Europe/Helsinki")).toMatchObject({ startKey: "2026-03-01", endKeyExclusive: "2026-04-01", daysLeft: 3, dayOfPeriod: 29 });
    expect(at("2026-11-02T12:00:00Z", "America/New_York", 3)).toMatchObject({ startKey: "2026-10-03", endKeyExclusive: "2026-11-03", daysLeft: 1 });
  });

  it("uses the machine's zone when none is given", () => {
    expect(periodOf(new Date("2026-11-12T10:00:00Z"), undefined, 1).startKey).toBe("2026-11-01");
  });
});
