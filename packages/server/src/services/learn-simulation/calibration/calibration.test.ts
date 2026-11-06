import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadVendorProfiles } from "../../../data-sources/vendor-profiles/loader.js";
import {
  calibrationCaptureSchema,
  type CalibrationCapture,
} from "./capture.js";
import { replayCapture, type ReplayRow } from "./replay.js";

// Step 13.5a (D10, D12): each real capture is replayed through the
// simulator, and every request must match the recorded hit/miss and read
// within 5% of the recorded cache read. A mismatch is resolved by fixing a
// rule or an assumption, never by editing a capture. The first request is
// not compared: it depends on caches (the shared tools and system prompt)
// from earlier sessions that the capture doesn't contain.
const TOLERANCE = 0.05;
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../../../fixtures/learn-calibration");
const profiles = loadVendorProfiles(
  path.resolve(here, "../../../../fixtures/vendor-profiles"),
);

// Disagreements the rules can't explain yet, each pinned to the request it
// happens on. A capture not listed here must match completely; one listed
// here must disagree on exactly these requests (so a fix, or a regression,
// shows up as a failing test that needs a decision).
const KNOWN_DISAGREEMENTS: Record<string, { requests: number[]; why: string }> =
  {
    "claude-code-39e87ae3": {
      requests: [14],
      why: "Claude Code's prompt changed ahead of the last messages (the log can't say what), so only part of the cache was read.",
    },
    "claude-code-2e4ad1d9": {
      requests: [20],
      why: "After a gap over an hour the whole conversation expired, but the tools and system prompt were still warm from other sessions: the cache is shared across sessions.",
    },
  };

const captures: CalibrationCapture[] = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) =>
    calibrationCaptureSchema.parse(
      JSON.parse(readFileSync(path.join(dir, file), "utf-8")),
    ),
  );

function disagreements(rows: ReplayRow[]): ReplayRow[] {
  return rows.slice(1).filter((row) => {
    const sameOutcome = row.recorded.outcome === row.simulated.outcome;
    const withinTolerance =
      Math.abs(row.simulated.cacheRead - row.recorded.cacheRead) <=
      TOLERANCE * row.recorded.cacheRead;
    return !(sameOutcome && withinTolerance);
  });
}

describe("calibration against real captures", () => {
  it("has captures from Claude Code and from Copilot", () => {
    expect(captures.some((c) => c.source === "claude-code")).toBe(true);
    expect(captures.some((c) => c.source.startsWith("copilot"))).toBe(true);
  });

  for (const capture of captures) {
    it(`${capture.id}: ${capture.requests.length} requests on ${capture.modelId}`, () => {
      const profile = profiles.find((p) => p.vendorId === capture.vendorId)!;
      const wrong = disagreements(replayCapture(capture, profile)).map(
        (row) => row.index,
      );
      expect(wrong).toEqual(KNOWN_DISAGREEMENTS[capture.id]?.requests ?? []);
    });
  }

  it("covers a gap that outlives the 5-minute default, which only the 1-hour lifetime explains", () => {
    const longGap = captures.filter(
      (c) =>
        c.source === "claude-code" &&
        c.requests.some((r) => r.gapMinutes > 5 && r.recorded.cacheRead > 0),
    );
    expect(longGap.length).toBeGreaterThan(0);
  });
});
