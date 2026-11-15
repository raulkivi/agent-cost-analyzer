// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { addToTotals, emptyTotals, failureRateOf, isFailedCall } from "./outcome-tally.js";

describe("a canceled call (D14)", () => {
  const canceled = { name: "run_in_terminal", argsSummary: "npm test", outcome: { status: "canceled" as const } };

  it("is not a failure", () => {
    expect(isFailedCall(canceled)).toBe(false);
  });

  it("counts as a call without becoming a success, failure or unknown", () => {
    const totals = emptyTotals();
    addToTotals(totals, canceled);

    expect(totals).toEqual({ ...emptyTotals(), toolCalls: 1 });
    expect(failureRateOf(totals)).toBe(0);
  });
});
