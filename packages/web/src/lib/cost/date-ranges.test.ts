// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { bucketAxisLabel, bucketLongLabel, compareBucketFor, previousRange, rangeFor } from "./date-ranges.js";

const NOW = new Date("2026-11-06T12:00:00.000Z");

describe("date range presets (plan §11.2: date range first, with presets)", () => {
  it("resolves each preset to inclusive UTC calendar dates", () => {
    expect(rangeFor("this-month", NOW)).toEqual({ since: "2026-11-01", until: "2026-11-06" });
    expect(rangeFor("last-month", NOW)).toEqual({ since: "2026-10-01", until: "2026-10-31" });
    expect(rangeFor("last-90-days", NOW)).toEqual({ since: "2026-08-09", until: "2026-11-06" });
    expect(rangeFor("this-year", NOW)).toEqual({ since: "2026-01-01", until: "2026-11-06" });
  });

  it("handles January's last month", () => {
    expect(rangeFor("last-month", new Date("2027-01-15T00:00:00Z"))).toEqual({ since: "2026-12-01", until: "2026-12-31" });
  });

  it("gives the previous period of the same length", () => {
    expect(previousRange({ since: "2026-08-09", until: "2026-11-06" })).toEqual({ since: "2026-05-11", until: "2026-08-08" });
  });

  it("labels buckets on the axis and in full", () => {
    expect(bucketAxisLabel({ period: "2026-10-07", start: "2026-10-07", end: "2026-10-07" }, "day")).toBe("Oct 7");
    expect(bucketAxisLabel({ period: "2026-W41", start: "2026-10-05", end: "2026-10-11" }, "week")).toBe("Oct 5");
    expect(bucketAxisLabel({ period: "2026-10", start: "2026-10-01", end: "2026-10-31" }, "month")).toBe("Oct 2026");
    expect(bucketLongLabel({ period: "2026-W41", start: "2026-10-05", end: "2026-10-11" }, "week")).toBe("Week of Oct 5, 2026");
    expect(bucketLongLabel({ period: "2026-10-07", start: "2026-10-07", end: "2026-10-07" }, "day")).toBe("Oct 7, 2026");
    expect(bucketLongLabel({ period: "2026-10", start: "2026-10-01", end: "2026-10-31" }, "month")).toBe("October 2026");
  });

  it("picks the compare chart's bucket by the range's length", () => {
    expect(compareBucketFor({ since: "2026-11-01", until: "2026-11-06" })).toBe("day");
    expect(compareBucketFor({ since: "2026-08-09", until: "2026-11-06" })).toBe("week");
    expect(compareBucketFor({ since: "2026-01-01", until: "2026-11-06" })).toBe("month");
  });
});
