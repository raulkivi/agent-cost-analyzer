import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  replaySelfCheckSchema,
  REPLAY_READ_TOLERANCE_PERCENT,
  type CacheOutcome,
  type RequestTrace,
  type Session,
  type TraceRequest,
} from "@agent-cost-analyzer/domain";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { calibrationCaptureSchema } from "../learn-simulation/calibration/capture.js";
import { traceFromCapture } from "../learn-simulation/calibration/replay.js";
import { simulateScenario } from "../learn-simulation/simulate-scenario.js";
import { scriptFromRequestTrace } from "./request-trace-scripter.js";
import { replaySelfCheck, selfCheckMismatches } from "./replay-self-check.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../../fixtures");
const profiles = loadVendorProfiles(path.join(fixtures, "vendor-profiles"));

const req = (
  index: number,
  cacheRead: number,
  uncachedInput = 0,
): TraceRequest => ({
  index,
  turnIndex: index,
  startedAt: new Date(Date.UTC(2026, 10, 1, 10, index)).toISOString(),
  model: "m",
  uncachedInput,
  cacheRead,
  cacheWrite: 0,
  output: 0,
});
const trace = (requests: TraceRequest[]): RequestTrace => ({
  sessionId: "s1",
  providerId: "claude-code",
  harness: "claude-code",
  requests,
  notTraced: [],
});

type FakeTurn = { cacheRead: number | null; outcome: CacheOutcome };
// Only the fields the self-check reads.
const session = (turns: FakeTurn[]): Session =>
  ({
    turns: turns.map((t) => ({
      usage: {
        cacheRead:
          t.cacheRead === null
            ? { known: false, reason: "unknown" }
            : { known: true, value: t.cacheRead },
      },
      simulation: { cacheOutcome: t.outcome },
    })),
  }) as unknown as Session;

describe("replaySelfCheck", () => {
  it("never compares the first request (A3, cold start)", () => {
    const check = replaySelfCheck(
      trace([req(0, 999), req(1, 1000)]),
      session([
        { cacheRead: 0, outcome: "miss" },
        { cacheRead: 1000, outcome: "hit" },
      ]),
      "claude-opus-5.5",
    );
    expect(check).toEqual({
      model: "claude-opus-5.5",
      requests: 1,
      matching: 1,
      readTolerancePercent: REPLAY_READ_TOLERANCE_PERCENT,
      passed: true,
    });
  });

  it("a one-request trace compares nothing and passes", () => {
    const check = replaySelfCheck(
      trace([req(0, 0)]),
      session([{ cacheRead: 7, outcome: "partial" }]),
      "m",
    );
    expect(check).toMatchObject({ requests: 0, matching: 0, passed: true });
  });

  it("matches a read within the tolerance, and not beyond it", () => {
    // Previous input 1000; recorded read 1000 (hit).
    const t = trace([req(0, 0, 1000), req(1, 1000), req(2, 1000)]);
    const check = replaySelfCheck(
      t,
      session([
        { cacheRead: 0, outcome: "miss" },
        { cacheRead: 950, outcome: "hit" }, // 5% below: matches
        { cacheRead: 949, outcome: "hit" }, // beyond 5%: doesn't
      ]),
      "m",
    );
    expect(check).toMatchObject({ requests: 2, matching: 1, passed: false });
    expect(
      selfCheckMismatches(
        t,
        session([
          { cacheRead: 0, outcome: "miss" },
          { cacheRead: 950, outcome: "hit" },
          { cacheRead: 949, outcome: "hit" },
        ]),
      ),
    ).toEqual([2]);
  });

  it("needs the recorded outcome, from the previous request's input", () => {
    // Previous input 1000, read 500: a partial hit.
    const t = trace([req(0, 0, 1000), req(1, 500, 500)]);
    expect(
      replaySelfCheck(
        t,
        session([
          { cacheRead: 0, outcome: "miss" },
          { cacheRead: 500, outcome: "hit" },
        ]),
        "m",
      ).matching,
    ).toBe(0);
    expect(
      replaySelfCheck(
        t,
        session([
          { cacheRead: 0, outcome: "miss" },
          { cacheRead: 500, outcome: "partial" },
        ]),
        "m",
      ).matching,
    ).toBe(1);
  });

  it("a recorded miss needs a simulated read of exactly 0", () => {
    const t = trace([req(0, 0, 1000), req(1, 0, 1000)]);
    const miss = (read: number) =>
      replaySelfCheck(
        t,
        session([
          { cacheRead: 0, outcome: "miss" },
          { cacheRead: read, outcome: "miss" },
        ]),
        "m",
      ).matching;
    expect(miss(0)).toBe(1);
    expect(miss(1)).toBe(0);
  });

  it("a simulated turn with unknown counts never matches", () => {
    const t = trace([req(0, 0, 1000), req(1, 1000)]);
    const check = replaySelfCheck(
      t,
      session([
        { cacheRead: 0, outcome: "miss" },
        { cacheRead: null, outcome: "unknown" },
      ]),
      "m",
    );
    expect(check).toMatchObject({ requests: 1, matching: 0, passed: false });
  });

  it("refuses a simulated session that isn't one turn per request", () => {
    expect(() =>
      replaySelfCheck(
        trace([req(0, 0), req(1, 0)]),
        session([{ cacheRead: 0, outcome: "miss" }]),
        "m",
      ),
    ).toThrow(/one simulated turn per request/);
  });

  it("parses with the domain schema", () => {
    const check = replaySelfCheck(
      trace([req(0, 0, 1000), req(1, 1000)]),
      session([
        { cacheRead: 0, outcome: "miss" },
        { cacheRead: 0, outcome: "miss" },
      ]),
      "m",
    );
    expect(() => replaySelfCheckSchema.parse(check)).not.toThrow();
  });
});

// Copied from calibration.test.ts's KNOWN_DISAGREEMENTS (keep them in step):
// the self-check is calibration's own check, so on every calibration
// capture it disagrees on exactly the requests calibration does.
const KNOWN_DISAGREEMENTS: Record<string, number[]> = {
  "claude-code-39e87ae3": [14],
  "claude-code-2e4ad1d9": [20],
};

describe("replaySelfCheck over the calibration captures", () => {
  const dir = path.join(fixtures, "learn-calibration");
  const captures = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) =>
      calibrationCaptureSchema.parse(
        JSON.parse(readFileSync(path.join(dir, file), "utf-8")),
      ),
    );

  it("has captures", () => {
    expect(captures.length).toBeGreaterThan(0);
  });

  for (const capture of captures) {
    it(`${capture.id}: disagrees where calibration does`, () => {
      const profile = profiles.find((p) => p.vendorId === capture.vendorId)!;
      const t = traceFromCapture(capture);
      // As replayCapture simulates it.
      const simulated = simulateScenario(scriptFromRequestTrace(t), {
        profile,
        modelId: capture.modelId,
        harness: capture.harness,
        harnessCacheDefaults: false,
      });
      const wrong = KNOWN_DISAGREEMENTS[capture.id] ?? [];
      expect(selfCheckMismatches(t, simulated)).toEqual(wrong);
      const check = replaySelfCheck(t, simulated, capture.modelId);
      expect(replaySelfCheckSchema.parse(check)).toEqual({
        model: capture.modelId,
        requests: capture.requests.length - 1,
        matching: capture.requests.length - 1 - wrong.length,
        readTolerancePercent: REPLAY_READ_TOLERANCE_PERCENT,
        passed: wrong.length === 0,
      });
    });
  }
});
