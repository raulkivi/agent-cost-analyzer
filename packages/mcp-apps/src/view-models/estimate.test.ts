// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { estimate, refusedEstimate, simulatedEstimate } from "./increment3-fixtures.js";
import { toEstimateViewModel } from "./estimate.js";

describe("toEstimateViewModel", () => {
  it("shows the p50-p90 range in USD, labelled estimate, never one number", () => {
    const vm = toEstimateViewModel(estimate());
    expect(vm).toMatchObject({ label: "estimate", refused: false, rangeText: "$95.00 – $210.00", p50Text: "$95.00", p90Text: "$210.00", targetName: "Customer portal" });
    expect(vm.refusal).toBeUndefined();
  });

  it("states the plan, the window and the prices", () => {
    const vm = toEstimateViewModel(estimate());
    expect(vm.plannedText).toBe("10 active days");
    expect(vm.windowText).toBe("last 12 weeks (Aug 17 – Nov 9)");
    expect(vm.pricingText).toBe("today's prices");
    expect(vm.conversionNote).toContain("1 AI Credit = $0.01");
  });

  it("shows the per-unit cost range", () => {
    expect(toEstimateViewModel(estimate()).unitCostText).toBe("$9.50 – $21.00 per active day");
    expect(toEstimateViewModel(estimate({ unit: "sessions", planned: 1 })).plannedText).toBe("1 session");
  });

  it("shows the sample the range rests on", () => {
    expect(toEstimateViewModel(estimate()).sample).toEqual({
      unitsText: "24 active days seen, 20 with every turn priced",
      turnsText: "800 turns",
      totalText: "$310.40",
      runRateText: "$12.90 per active day, $25.87 per week",
    });
  });

  it("refuses with the reason and shows Unknown, never 0, for the figures it can't give", () => {
    const vm = toEstimateViewModel(refusedEstimate());
    expect(vm).toMatchObject({
      label: "estimate",
      refused: true,
      refusal: "Only 2 days have every turn priced; at least 5 are needed",
      rangeText: "Unknown",
      p50Text: "Unknown",
      p90Text: "Unknown",
      unitCostText: "Unknown",
    });
    expect(vm.sample.runRateText).toBe("Unknown per active day, $1.67 per week");
  });

  it("labels an estimate on another model simulated, with its coverage and self-check", () => {
    const vm = toEstimateViewModel(simulatedEstimate());
    expect(vm.label).toBe("estimate");
    expect(vm.simulation).toMatchObject({
      label: "Simulated",
      model: "claude-sonnet-5.5",
      pricingText: "priced as each session was used",
      sessionsText: "20 of 24 sessions replayed",
      turnsText: "700 of 800 turns replayed",
      selfCheckText: "self-check passed for 17 of 18 replayed sessions checked",
      notReplayed: [{ reason: "A request in this turn has no complete usage figures", turnsText: "100 turns" }],
    });
    expect(vm.pricingText).toBe("prices as of use");
  });

  it("has no simulation block at today's prices", () => {
    expect(toEstimateViewModel(estimate()).simulation).toBeUndefined();
  });
});
