// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { turnSeriesSchema, unavailableTokenCount, type Session, type TokenCount, type Turn, type TurnUsage } from "@agent-cost-analyzer/domain";
import { buildTurnSeries } from "./turn-series-builder.js";

const k = (value: number, estimated?: boolean): TokenCount => ({ known: true, value, ...(estimated ? { estimated } : {}) });

function usage(overrides: Partial<TurnUsage> = {}): TurnUsage {
  return {
    uncachedInput: k(10),
    cacheWrite: k(0),
    cacheRead: k(90),
    tool: unavailableTokenCount("n/a"),
    vision: unavailableTokenCount("n/a"),
    reasoning: unavailableTokenCount("n/a"),
    output: k(5),
    costAiCredits: k(2),
    model: "model-a",
    ...overrides,
  };
}

function turn(index: number, overrides: Partial<Turn> = {}): Turn {
  return { index, userMessage: `prompt ${index}`, assistantResponse: "", toolCalls: [], usage: usage(), explanation: "", ...overrides };
}

function session(turns: Turn[]): Session {
  return {
    id: "s1",
    mode: "analyze",
    providerId: "claude-code",
    title: "Refactor",
    model: "model-a",
    turns,
    turnCount: turns.length,
    costAiCredits: unavailableTokenCount("n/a"),
    usageDataAvailable: true,
  };
}

const many = (count: number) => Array.from({ length: count }, (_, i) => turn(i));

describe("buildTurnSeries", () => {
  it("returns the per-turn figures and a schema-valid series", () => {
    const series = buildTurnSeries(session([turn(0, { startedAt: "2026-09-27T08:00:00.000Z" })]));

    expect(turnSeriesSchema.parse(series)).toEqual(series);
    expect(series).toEqual({
      sessionId: "s1",
      turns: [
        { turnIndex: 0, startedAt: "2026-09-27T08:00:00.000Z", model: "model-a", aiCredits: 2, inputTokens: 100, cacheRead: 90, output: 5, estimated: false, events: [] },
      ],
      totalTurns: 1,
      truncated: false,
    });
  });

  it("keeps unknown figures null, never 0, and omits an unknown start time", () => {
    const unknown = unavailableTokenCount("lost");
    const series = buildTurnSeries(
      session([turn(0, { usage: usage({ cacheRead: unknown, output: unknown, costAiCredits: unknown }) })]),
    );

    const [first] = series.turns;
    expect(first).toMatchObject({ aiCredits: null, inputTokens: null, cacheRead: null, output: null });
    expect(first).not.toHaveProperty("startedAt");
  });

  it("flags a turn with a local-tokenizer estimate", () => {
    const series = buildTurnSeries(session([turn(0, { usage: usage({ output: k(7, true) }) })]));

    expect(series.turns[0]?.estimated).toBe(true);
  });

  it("attaches a triggered event to its own turn only", () => {
    const series = buildTurnSeries(session([turn(0), turn(1, { triggeredEvent: "compaction" }), turn(2)]));

    expect(series.turns.map((t) => t.events)).toEqual([[], ["compaction"], []]);
  });

  it("returns an empty series for a session without turns", () => {
    expect(buildTurnSeries(session([]))).toEqual({ sessionId: "s1", turns: [], totalTurns: 0, truncated: false });
  });

  it("keeps the first maxTurns turns and reports truncation", () => {
    const series = buildTurnSeries(session(many(10)), 3);

    expect(series.turns.map((t) => t.turnIndex)).toEqual([0, 1, 2]);
    expect(series.totalTurns).toBe(10);
    expect(series.truncated).toBe(true);
  });

  it("is not truncated when the turns fit exactly", () => {
    const series = buildTurnSeries(session(many(3)), 3);

    expect(series.turns).toHaveLength(3);
    expect(series.truncated).toBe(false);
  });

  it("defaults to 500 turns", () => {
    expect(buildTurnSeries(session(many(501))).turns).toHaveLength(500);
  });

  it("clamps maxTurns to 1..2000", () => {
    expect(buildTurnSeries(session(many(5)), 0).turns).toHaveLength(1);
    expect(buildTurnSeries(session(many(5)), -7).turns).toHaveLength(1);
    expect(buildTurnSeries(session(many(2001)), 99999).turns).toHaveLength(2000);
    expect(buildTurnSeries(session(many(5)), 2.9).turns).toHaveLength(2);
  });
});
