// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  addToTotals,
  emptyTotals,
  failureRateOf,
  isFailedCall,
  MAIN_ORIGIN_KEY,
  originKeyOf,
  tallyByOrigin,
} from "./outcome-tally.js";

describe("a canceled call (D14)", () => {
  const canceled = { name: "run_in_terminal", argsSummary: "npm test", outcome: { status: "canceled" as const } };

  it("is not a failure", () => {
    expect(isFailedCall(canceled)).toBe(false);
  });

  it("counts as a call in its own canceled bucket, not a success, failure or unknown", () => {
    const totals = emptyTotals();
    addToTotals(totals, canceled);

    expect(totals).toEqual({ ...emptyTotals(), toolCalls: 1, canceled: 1 });
  });

  it("is left out of the failure rate: no known outcome gives null, not 0%", () => {
    const totals = emptyTotals();
    addToTotals(totals, canceled);
    expect(failureRateOf(totals)).toBeNull();
  });

  it("does not dilute the failure rate of the calls with a result", () => {
    const totals = emptyTotals();
    addToTotals(totals, canceled);
    addToTotals(totals, { name: "x", argsSummary: "", outcome: { status: "error" } });
    addToTotals(totals, { name: "x", argsSummary: "", outcome: { status: "success" } });
    expect(failureRateOf(totals)).toBe(0.5);
  });
});

describe("originKeyOf", () => {
  const base = { name: "Bash", argsSummary: "" };

  it("is main for a record without origin and for an explicit main origin", () => {
    expect(originKeyOf(base)).toBe(MAIN_ORIGIN_KEY);
    expect(originKeyOf({ ...base, origin: { kind: "main" } })).toBe(MAIN_ORIGIN_KEY);
  });

  it("is the run for a subagent call, and never collides with main even for a run named main", () => {
    const origin = { kind: "subagent" as const, runId: "main", label: "searchSubagent", depth: 1 };
    expect(originKeyOf({ ...base, origin })).not.toBe(MAIN_ORIGIN_KEY);
    expect(originKeyOf({ ...base, origin })).not.toBe(originKeyOf({ ...base, origin: { ...origin, runId: "other" } }));
  });
});

describe("tallyByOrigin", () => {
  const ok = { status: "success" as const };
  const err = { status: "error" as const, failureCategory: "timeout" as const };
  const sub = { kind: "subagent" as const, runId: "r1", label: "searchSubagent", depth: 1 };

  it("splits calls into main and subagent totals", () => {
    const split = tallyByOrigin([
      { name: "a", argsSummary: "", outcome: ok },
      { name: "b", argsSummary: "", outcome: err, origin: sub },
      { name: "c", argsSummary: "", origin: sub },
    ]);

    expect(split.main).toEqual({ ...emptyTotals(), toolCalls: 1, succeeded: 1 });
    expect(split.subagents).toEqual({ ...emptyTotals(), toolCalls: 2, failed: 1, unknown: 1 });
  });

  it("returns empty totals for no calls", () => {
    expect(tallyByOrigin([])).toEqual({ main: emptyTotals(), subagents: emptyTotals() });
  });
});
