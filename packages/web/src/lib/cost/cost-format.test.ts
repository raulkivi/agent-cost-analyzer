import { describe, expect, it } from "vitest";
import type { CostTotal } from "@agent-cost-analyzer/domain";
import { amountIn, conversionNote, coverageNote, formatAmount, formatChange, formatPercent, formatUnitPrice, unitLabel } from "./cost-format.js";

const total = (usd: number | null, amounts: CostTotal["amounts"] = [], knownTurns = 1, turns = 1): CostTotal => ({
  turns,
  knownTurns,
  amounts,
  usd,
  estimated: false,
  apiEquivalentTurns: 0,
});

describe("cost formatting (plan §11.6 Content)", () => {
  it("shows a total in AI Credits or USD at 1 AI Credit = $0.01, and unknown as null", () => {
    expect(amountIn(total(0.5), "AI_CREDITS")).toBeCloseTo(50);
    expect(amountIn(total(0.5), "USD")).toBe(0.5);
    expect(amountIn(total(null, [], 0, 3), "USD")).toBeNull();
  });

  it("formats AI Credits with 2 decimals and grouping, USD with a dollar sign, unknown as unknown (never 0.00)", () => {
    expect(formatAmount(1234.5, "AI_CREDITS")).toBe("1,234.50");
    expect(formatAmount(0.0085, "USD")).toBe("$0.0085");
    expect(formatAmount(1234.5, "USD")).toBe("$1,234.50");
    expect(formatAmount(null, "AI_CREDITS")).toBe("unknown");
  });

  it("names the unit", () => {
    expect(unitLabel("AI_CREDITS")).toBe("AI Credits");
    expect(unitLabel("USD")).toBe("USD");
  });

  it("states coverage, and says nothing is missing only when it is complete", () => {
    expect(coverageNote({ turns: 430, knownTurns: 412 })).toBe("412 of 430 turns known");
    expect(coverageNote({ turns: 4, knownTurns: 4 })).toBe("all 4 turns known");
    expect(coverageNote({ turns: 0, knownTurns: 0 })).toBe("no turns");
  });

  it("signs a change with + or a minus sign, and leaves an unknown change unknown", () => {
    expect(formatChange(0.178)).toBe("+17.8%");
    expect(formatChange(-0.032)).toBe("−3.2%");
    expect(formatChange(0)).toBe("0.0%");
    expect(formatChange(null)).toBe("unknown");
  });

  it("formats a share or ratio as a percentage", () => {
    expect(formatPercent(0.527)).toBe("52.7%");
    expect(formatPercent(null)).toBe("unknown");
  });

  it("formats a unit price per 1M tokens, and a missing one as none", () => {
    expect(formatUnitPrice(0.2)).toBe("$0.20");
    expect(formatUnitPrice(null)).toBe("none");
  });

  it("states the conversion only when a figure was converted", () => {
    expect(conversionNote(["AI_CREDITS"], "AI_CREDITS")).toBeUndefined();
    expect(conversionNote(["AI_CREDITS", "USD"], "AI_CREDITS")).toBe("USD figures converted at 1 AI Credit = $0.01.");
    expect(conversionNote(["AI_CREDITS"], "USD")).toBe("AI Credits converted at 1 AI Credit = $0.01.");
  });
});
