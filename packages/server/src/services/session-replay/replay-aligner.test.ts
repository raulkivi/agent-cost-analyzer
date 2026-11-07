// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  replayCoverageSchema,
  replayTotalSchema,
  replayTurnSchema,
  sessionReplaySchema,
  type MeasuredCost,
  type RequestTrace,
  type TraceRequest,
} from "@agent-cost-analyzer/domain";
import {
  alignReplay,
  NO_TRACED_REQUEST_REASON,
  type AlignReplayInput,
  type ReplayRequestFigures,
  type SimulatedRequest,
} from "./replay-aligner.js";

const req = (index: number, turnIndex: number): TraceRequest => ({
  index,
  turnIndex,
  startedAt: new Date(Date.UTC(2026, 10, 1, 10, index)).toISOString(),
  model: "m",
  uncachedInput: 10,
  cacheRead: 0,
  cacheWrite: 0,
  output: 1,
});
const trace = (
  turnIndexes: number[],
  notTraced: RequestTrace["notTraced"] = [],
): RequestTrace => ({
  sessionId: "s1",
  providerId: "claude-code",
  harness: "claude-code",
  requests: turnIndexes.map((turn, i) => req(i, turn)),
  notTraced,
});
const usd = (value: number): ReplayRequestFigures["cost"] => ({
  known: true,
  value,
  currency: "USD",
});
const fig = (
  cacheRead: number,
  cacheWrite: number,
  outcome: ReplayRequestFigures["outcome"],
  cost: ReplayRequestFigures["cost"] = usd(1),
): ReplayRequestFigures => ({ cacheRead, cacheWrite, outcome, cost });
const measured = (value: number | null, cacheRead: number | null = 5) => ({
  cacheRead,
  cost:
    value === null
      ? ({ known: false, reason: "No price for this model." } as const)
      : ({ known: true, value, currency: "USD", basis: "priced" } as const),
});

const base = (over: Partial<AlignReplayInput>): AlignReplayInput => ({
  trace: trace([]),
  turnCount: 0,
  measured: [],
  simulated: [],
  currency: "USD",
  ...over,
});

describe("alignReplay", () => {
  it("sums each turn's requests and copies the measured figures", () => {
    const out = alignReplay(
      base({
        trace: trace([0, 0, 1]),
        turnCount: 2,
        measured: [measured(4, 100), measured(2, null)],
        simulated: [
          fig(0, 50, "miss", usd(1)),
          fig(50, 10, "hit", usd(0.5)),
          fig(60, 5, "hit", usd(0.25)),
        ],
      }),
    );
    expect(out.turns).toEqual([
      {
        turnIndex: 0,
        measured: measured(4, 100),
        simulated: {
          cacheRead: 50,
          cacheWrite: 60,
          outcome: "miss",
          cost: usd(1.5),
        },
      },
      {
        turnIndex: 1,
        measured: measured(2, null),
        simulated: {
          cacheRead: 60,
          cacheWrite: 5,
          outcome: "hit",
          cost: usd(0.25),
        },
      },
    ]);
    expect(out.totals).toEqual({
      measured: { value: 6, knownTurns: 2, turns: 2 },
      simulated: { value: 1.75, knownTurns: 2, turns: 2 },
      difference: 1.75 - 6,
    });
    expect(out.coverage).toEqual({
      turns: 2,
      replayedTurns: 2,
      requests: 3,
      replayedRequests: 3,
      notReplayed: [],
    });
  });

  it("a turn's outcome is miss if any request missed, else partial if any was, else hit", () => {
    const outcomes = (o: ReplayRequestFigures["outcome"][]) =>
      alignReplay(
        base({
          trace: trace(o.map(() => 0)),
          turnCount: 1,
          measured: [measured(1)],
          simulated: o.map((x) => fig(0, 0, x)),
        }),
      ).turns[0]!.simulated!.outcome;
    expect(outcomes(["hit", "partial", "miss"])).toBe("miss");
    expect(outcomes(["hit", "partial", "hit"])).toBe("partial");
    expect(outcomes(["hit", "hit"])).toBe("hit");
  });

  it("a turn with any unknown request is not replayed, with that request's reason", () => {
    const out = alignReplay(
      base({
        trace: trace([0, 0, 1]),
        turnCount: 2,
        measured: [measured(1), measured(1)],
        simulated: [
          fig(0, 1, "miss"),
          { unknown: "xAI's cache is unknown." },
          fig(1, 1, "hit"),
        ],
      }),
    );
    expect(out.turns[0]).toEqual({
      turnIndex: 0,
      measured: measured(1),
      simulated: null,
      notReplayedReason: "xAI's cache is unknown.",
    });
    expect(out.coverage).toMatchObject({
      replayedTurns: 1,
      requests: 3,
      replayedRequests: 1,
      notReplayed: [{ reason: "xAI's cache is unknown.", turns: 1 }],
    });
    // Totals pair only turn 1.
    expect(out.totals.measured).toEqual({ value: 1, knownTurns: 1, turns: 2 });
    expect(out.totals.simulated).toEqual({ value: 1, knownTurns: 1, turns: 2 });
  });

  it("an outcome of unknown counts as an unknown request", () => {
    const out = alignReplay(
      base({
        trace: trace([0]),
        turnCount: 1,
        measured: [measured(1)],
        simulated: [fig(0, 0, "unknown")],
      }),
    );
    expect(out.turns[0]!.simulated).toBeNull();
    expect(out.turns[0]!.notReplayedReason).toMatch(/unknown/);
  });

  it("an untraced turn keeps its reason, and a turn in neither list gets the defensive one", () => {
    const out = alignReplay(
      base({
        trace: trace([1], [{ turnIndex: 0, reason: "Sub-agent only." }]),
        turnCount: 4,
        measured: [measured(1), measured(1), measured(1), measured(1)],
        simulated: [fig(0, 1, "miss")],
      }),
    );
    expect(out.turns.map((t) => t.notReplayedReason)).toEqual([
      "Sub-agent only.",
      undefined,
      NO_TRACED_REQUEST_REASON,
      NO_TRACED_REQUEST_REASON,
    ]);
    expect(out.coverage.notReplayed).toEqual([
      { reason: "Sub-agent only.", turns: 1 },
      { reason: NO_TRACED_REQUEST_REASON, turns: 2 },
    ]);
  });

  it("a turn's simulated cost is unknown when any request's is, with the first reason", () => {
    const out = alignReplay(
      base({
        trace: trace([0, 0, 0]),
        turnCount: 1,
        measured: [measured(1)],
        simulated: [
          fig(0, 1, "miss"),
          fig(1, 1, "hit", { known: false, reason: "No API price." }),
          fig(1, 1, "hit", { known: false, reason: "Second reason." }),
        ],
      }),
    );
    expect(out.turns[0]!.simulated!.cost).toEqual({
      known: false,
      reason: "No API price.",
    });
    expect(out.totals).toEqual({
      measured: { value: null, knownTurns: 0, turns: 1 },
      simulated: { value: null, knownTurns: 0, turns: 1 },
      difference: null,
    });
  });

  it("a request cost in another currency makes the turn's cost unknown", () => {
    const out = alignReplay(
      base({
        trace: trace([0]),
        turnCount: 1,
        measured: [measured(1)],
        simulated: [
          fig(0, 1, "miss", { known: true, value: 3, currency: "AI_CREDITS" }),
        ],
      }),
    );
    expect(out.turns[0]!.simulated!.cost).toEqual({
      known: false,
      reason:
        "A request's simulated cost is in AI_CREDITS, not the replay's USD.",
    });
  });

  it("totals compare like with like: only turns with both costs known", () => {
    const out = alignReplay(
      base({
        trace: trace([0, 1]),
        turnCount: 2,
        measured: [measured(10), measured(null)],
        simulated: [fig(0, 1, "miss", usd(2)), fig(1, 1, "hit", usd(3))],
      }),
    );
    expect(out.totals).toEqual({
      measured: { value: 10, knownTurns: 1, turns: 2 },
      simulated: { value: 2, knownTurns: 1, turns: 2 },
      difference: -8,
    });
  });

  it("refuses inputs that don't line up", () => {
    expect(() =>
      alignReplay(
        base({
          trace: trace([0]),
          turnCount: 1,
          measured: [],
          simulated: [fig(0, 0, "miss")],
        }),
      ),
    ).toThrow(/measured/);
    expect(() =>
      alignReplay(
        base({
          trace: trace([0]),
          turnCount: 1,
          measured: [measured(1)],
          simulated: [],
        }),
      ),
    ).toThrow(/simulated/);
    expect(() =>
      alignReplay(
        base({
          trace: trace([0]),
          turnCount: 1,
          measured: [
            {
              cacheRead: 1,
              cost: {
                known: true,
                value: 1,
                currency: "AI_CREDITS",
                basis: "billed",
              },
            },
          ],
          simulated: [fig(0, 0, "miss")],
        }),
      ),
    ).toThrow(/currency/);
  });

  it("property: always schema-valid, coverage adds up, difference = simulated − measured", () => {
    const reason = fc.constantFrom("Reason A.", "Reason B.", "Reason C.");
    const cost = fc.oneof(
      fc.record({
        known: fc.constant(true as const),
        value: fc.double({ min: 0, max: 1000, noNaN: true }),
        currency: fc.constant("USD" as const),
      }),
      fc.record({ known: fc.constant(false as const), reason }),
    );
    const simulatedRequest: fc.Arbitrary<SimulatedRequest> = fc.oneof(
      fc.record({
        cacheRead: fc.nat(1e6),
        cacheWrite: fc.nat(1e6),
        outcome: fc.constantFrom("hit", "partial", "miss", "unknown" as const),
        cost,
      }),
      fc.record({ unknown: reason }),
    );
    const measuredCost: fc.Arbitrary<MeasuredCost> = fc.oneof(
      fc.record({
        known: fc.constant(true as const),
        value: fc.double({ min: 0, max: 1000, noNaN: true }),
        currency: fc.constant("USD" as const),
        basis: fc.constantFrom("billed", "reported", "priced" as const),
      }),
      fc.record({ known: fc.constant(false as const), reason }),
    );
    const input = fc
      .integer({ min: 0, max: 8 })
      .chain((turnCount) =>
        fc.record({
          turnCount: fc.constant(turnCount),
          // Per turn: traced (with 1-3 requests), untraced, or neither.
          kinds: fc.array(
            fc.oneof(
              fc.integer({ min: 1, max: 3 }),
              fc.constant("untraced" as const),
              fc.constant("none" as const),
            ),
            { minLength: turnCount, maxLength: turnCount },
          ),
          measured: fc.array(
            fc.record({
              cacheRead: fc.option(fc.nat(1e6), { nil: null }),
              cost: measuredCost,
            }),
            {
              minLength: turnCount,
              maxLength: turnCount,
            },
          ),
          simulated: fc.array(simulatedRequest, {
            minLength: 3 * turnCount,
            maxLength: 3 * turnCount,
          }),
        }),
      )
      .map(({ turnCount, kinds, measured: m, simulated }): AlignReplayInput => {
        const turnIndexes: number[] = [];
        const notTraced: RequestTrace["notTraced"] = [];
        kinds.forEach((kind, turn) => {
          if (kind === "untraced")
            notTraced.push({ turnIndex: turn, reason: "Untraced." });
          else if (kind !== "none")
            for (let i = 0; i < kind; i++) turnIndexes.push(turn);
        });
        return {
          trace: trace(turnIndexes, notTraced),
          turnCount,
          measured: m,
          simulated: simulated.slice(0, turnIndexes.length),
          currency: "USD",
        };
      });

    fc.assert(
      fc.property(input, (i) => {
        const out = alignReplay(i);
        for (const turn of out.turns) replayTurnSchema.parse(turn);
        replayTotalSchema.parse(out.totals.measured);
        replayTotalSchema.parse(out.totals.simulated);
        replayCoverageSchema.parse(out.coverage);
        sessionReplaySchema.shape.totals.parse(out.totals);
        expect(out.turns.map((t) => t.turnIndex)).toEqual([
          ...Array(i.turnCount).keys(),
        ]);
        const notReplayed = out.coverage.notReplayed.reduce(
          (n, r) => n + r.turns,
          0,
        );
        expect(out.coverage.replayedTurns + notReplayed).toBe(i.turnCount);
        expect(out.totals.measured.knownTurns).toBe(
          out.totals.simulated.knownTurns,
        );
        const { measured: mt, simulated: st, difference } = out.totals;
        if (mt.value !== null && st.value !== null)
          expect(difference).toBe(st.value - mt.value);
        else expect(difference).toBeNull();
      }),
    );
  });
});
