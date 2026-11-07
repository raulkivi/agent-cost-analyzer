// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { formatAiCredits, formatAiCreditsValue } from "./format-ai-credits.js";

describe("formatAiCredits", () => {
  it("rounds a known value to 2 decimal places", () => {
    expect(formatAiCredits({ known: true, value: 309.106228 })).toBe("309.11");
    expect(formatAiCredits({ known: true, value: 2.79598 })).toBe("2.80");
    expect(formatAiCredits({ known: true, value: 0.01 })).toBe("0.01");
  });

  it("pads a whole number to 2 decimal places rather than dropping them", () => {
    expect(formatAiCredits({ known: true, value: 100 })).toBe("100.00");
  });

  it("returns an em dash for an unknown value", () => {
    expect(formatAiCredits({ known: false, reason: "no data" })).toBe("—");
  });
});

describe("formatAiCreditsValue", () => {
  it("applies the same 2 decimal place rule to a plain number", () => {
    expect(formatAiCreditsValue(309.106228)).toBe("309.11");
    expect(formatAiCreditsValue(2.79598)).toBe("2.80");
    expect(formatAiCreditsValue(100)).toBe("100.00");
    expect(formatAiCreditsValue(0)).toBe("0.00");
  });

  it("agrees with formatAiCredits for every known value", () => {
    for (const value of [0, 0.004, 0.005, 1.005, 18.42, 4.1, 142.6]) {
      expect(formatAiCreditsValue(value)).toBe(formatAiCredits({ known: true, value }));
    }
  });
});
