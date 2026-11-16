// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { atLeastNearAnswer, knownAnswer, noSessionsAnswer, noSourceAnswer, overAnswer, unknownAnswer } from "../../test-support/allowance-fixture.js";
import { allowanceDetailRows } from "./allowance-detail-rows.js";

const rowsOf = (answer: Parameters<typeof allowanceDetailRows>[0]) => allowanceDetailRows(answer).rows;

describe("allowanceDetailRows", () => {
  it("known: used, remaining, warn at, days left, period, coverage, oldest counted, source; no allowance row (the lead has it)", () => {
    expect(rowsOf(knownAnswer())).toEqual([
      { label: "Used", value: "31 % of the allowance used" },
      { label: "Remaining", value: "Up to 687.60 AI Credits remain" },
      { label: "Warn at", value: "80 % of the allowance" },
      { label: "Days left", value: "12 days left" },
      { label: "Period", value: "2026-11-01 to 2026-11-30 (Europe/Tallinn)" },
      { label: "Coverage", value: "20 of 20 sessions this month have cost data" },
      { label: "Oldest counted", value: "2026-11-01" },
      { label: "Source", value: "VS Code Insiders" },
    ]);
  });

  it("shows the reset day only when it is not the 1st", () => {
    expect(rowsOf(overAnswer()).some((row) => row.label === "Reset day")).toBe(false);
    const moved = knownAnswer({}, { settings: { resetDay: 15 } });
    expect(rowsOf(moved)).toContainEqual({ label: "Reset day", value: "15" });
  });

  it("over: 'No AI Credits remain'", () => {
    expect(rowsOf(overAnswer())).toContainEqual({ label: "Remaining", value: "No AI Credits remain" });
  });

  it("at least: 'At least 81 %' and the may-be-higher line comes out as the note", () => {
    const parts = allowanceDetailRows(atLeastNearAnswer());
    expect(parts.rows).toContainEqual({ label: "Used", value: "At least 81 % of the allowance used" });
    expect(parts.higherNote).toBe("The total may be higher: sessions without cost data are not counted.");
    expect(allowanceDetailRows(knownAnswer()).higherNote).toBeUndefined();
  });

  it("unknown: leads with the allowance, no used, remaining or warn at", () => {
    const labels = rowsOf(unknownAnswer()).map((row) => row.label);
    expect(labels).toEqual(["Allowance", "Days left", "Period", "Coverage", "Oldest counted", "Source"]);
    expect(rowsOf(unknownAnswer())[0]?.value).toBe("1,000 AI Credits");
  });

  it("no sessions: coverage says '0 sessions this month', never '0 of 0'", () => {
    expect(rowsOf(noSessionsAnswer()).map((row) => row.label)).toEqual(["Allowance", "Days left", "Period", "Coverage", "Source"]);
    expect(rowsOf(noSessionsAnswer())).toContainEqual({ label: "Coverage", value: "0 sessions this month" });
  });

  it("no source: the source is 'VS Code: not available'", () => {
    expect(rowsOf(noSourceAnswer()).at(-1)).toEqual({ label: "Source", value: "VS Code: not available" });
  });
});
