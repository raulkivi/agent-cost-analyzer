// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadVendorProfiles } from "../../../data-sources/vendor-profiles/loader.js";
import type { CalibrationCapture } from "./capture.js";
import { recordedOutcome, replayCapture, traceFromCapture } from "./replay.js";

const profile = loadVendorProfiles(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../fixtures/vendor-profiles",
  ),
).find((p) => p.vendorId === "anthropic")!;

const request = (
  index: number,
  gapMinutes: number,
  read: number,
  write: number,
  output = 100,
) => ({
  index,
  gapMinutes,
  recorded: { uncachedInput: 0, cacheRead: read, cacheWrite: write, output },
});
const capture = (
  requests: CalibrationCapture["requests"],
  extended = false,
): CalibrationCapture => ({
  id: "t",
  source: "claude-code",
  harness: "claude-code",
  vendorId: "anthropic",
  modelId: "claude-sonnet-5.5",
  requests: extended
    ? requests.map((r) => ({
        ...r,
        recorded: {
          ...r.recorded,
          extendedCacheWrite: r.recorded.cacheWrite,
          cacheWrite: 0,
        },
      }))
    : requests,
});

describe("recordedOutcome", () => {
  it("is a miss without a read, a hit when the whole previous prompt is read, else partial", () => {
    expect(recordedOutcome(0, 5000)).toBe("miss");
    expect(recordedOutcome(5000, 5000)).toBe("hit");
    expect(recordedOutcome(4000, 5000)).toBe("partial");
  });
});

describe("replayCapture", () => {
  it("reproduces a steadily growing conversation request by request", () => {
    // 5000 written, then +600 (100 output + 500 new) read the 5000 and write 600.
    const rows = replayCapture(
      capture([
        request(0, 0, 0, 5000),
        request(1, 1, 5000, 600),
        request(2, 1, 5600, 600),
      ]),
      profile,
    );
    expect(rows.map((r) => [r.recorded.outcome, r.simulated.outcome])).toEqual([
      ["miss", "miss"],
      ["hit", "hit"],
      ["hit", "hit"],
    ]);
    expect(rows[1]!.simulated.cacheRead).toBe(5000);
    expect(rows[2]!.simulated.cacheRead).toBe(5600);
  });

  it("shows a 5-minute lapse the capture did not have as a disagreement", () => {
    const rows = replayCapture(
      capture([request(0, 0, 0, 5000), request(1, 8, 5000, 600)]),
      profile,
    );
    expect(rows[1]!.recorded.outcome).toBe("hit");
    expect(rows[1]!.simulated.outcome).toBe("miss");
  });

  it("uses the 1-hour lifetime when the capture recorded extended writes", () => {
    const rows = replayCapture(
      capture([request(0, 0, 0, 5000), request(1, 8, 5000, 600)], true),
      profile,
    );
    expect(rows[1]!.simulated.outcome).toBe("hit");
  });

  it("replays a capture whose prompt shrinks as a compaction (step 14.3)", () => {
    // 5000 read, then the prompt drops to 2000: the first request was the
    // compaction request, so the second reads the prefix and writes the rest.
    const rows = replayCapture(
      capture([request(0, 0, 0, 5000), request(1, 1, 2000, 100)]),
      profile,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]!.simulated.outcome).toBe("partial");
    expect(rows[1]!.simulated.cacheRead + rows[1]!.simulated.cacheWrite).toBe(
      2100,
    );
  });
});

describe("traceFromCapture", () => {
  it("is the capture as a request trace: times from the gaps, 1-hour writes inside all writes", () => {
    const trace = traceFromCapture(
      capture([request(0, 0, 0, 5000), request(1, 2.5, 5000, 600)], true),
    );
    expect(trace.harness).toBe("claude-code");
    expect(trace.notTraced).toEqual([]);
    expect(trace.requests.map((r) => Date.parse(r.startedAt))).toEqual([
      Date.parse(trace.requests[0]!.startedAt),
      Date.parse(trace.requests[0]!.startedAt) + 150_000,
    ]);
    expect(trace.requests[1]).toMatchObject({
      index: 1,
      turnIndex: 1,
      model: "claude-sonnet-5.5",
      cacheRead: 5000,
      cacheWrite: 600,
      extendedCacheWrite: 600,
      output: 100,
    });
  });
});
