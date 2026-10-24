import { describe, expect, it } from "vitest";
import type { HarEntry } from "./har.js";
import { DEFAULT_IDLE_GAP_THRESHOLD_MS, splitEntriesByIdleGap } from "./split-entries-by-idle-gap.js";

function entryAt(startedDateTime: string): HarEntry {
  return {
    startedDateTime,
    request: { method: "POST", url: "https://example.com", headers: [] },
    response: { status: 200, headers: [], content: {} },
  };
}

describe("splitEntriesByIdleGap", () => {
  it("returns one segment when no gap between entries exceeds the threshold", () => {
    const entries = [
      entryAt("2026-08-01T12:00:00.000Z"),
      entryAt("2026-08-01T12:01:00.000Z"),
      entryAt("2026-08-01T12:02:00.000Z"),
    ];

    expect(splitEntriesByIdleGap(entries, 60_000)).toEqual([entries]);
  });

  it("starts a new segment when a gap strictly exceeds the threshold", () => {
    const entries = [entryAt("2026-08-01T12:00:00.000Z"), entryAt("2026-08-01T12:00:01.001Z")];

    expect(splitEntriesByIdleGap(entries, 1000)).toEqual([[entries[0]], [entries[1]]]);
  });

  it("does not split when the gap exactly equals the threshold", () => {
    const entries = [entryAt("2026-08-01T12:00:00.000Z"), entryAt("2026-08-01T12:00:01.000Z")];

    expect(splitEntriesByIdleGap(entries, 1000)).toEqual([entries]);
  });

  it("produces exactly one empty segment for zero entries", () => {
    expect(splitEntriesByIdleGap([], 1000)).toEqual([[]]);
  });

  it("returns a single one-element segment for exactly one entry", () => {
    const entries = [entryAt("2026-08-01T12:00:00.000Z")];

    expect(splitEntriesByIdleGap(entries, 1000)).toEqual([entries]);
  });

  it("produces more than two segments when there are multiple large gaps", () => {
    const entries = [
      entryAt("2026-08-01T12:00:00.000Z"),
      entryAt("2026-08-01T14:00:00.000Z"),
      entryAt("2026-08-01T14:00:30.000Z"),
      entryAt("2026-08-01T16:00:00.000Z"),
    ];

    expect(splitEntriesByIdleGap(entries, 60_000)).toEqual([
      [entries[0]],
      [entries[1], entries[2]],
      [entries[3]],
    ]);
  });

  it("does not split on a negative gap (out-of-order timestamps)", () => {
    const entries = [entryAt("2026-08-01T12:00:00.000Z"), entryAt("2026-08-01T11:00:00.000Z")];

    expect(splitEntriesByIdleGap(entries, 1000)).toEqual([entries]);
  });

  it("exports a 30-minute default threshold", () => {
    expect(DEFAULT_IDLE_GAP_THRESHOLD_MS).toBe(30 * 60 * 1000);
  });
});
