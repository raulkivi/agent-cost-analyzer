import { describe, expect, it } from "vitest";
import { formatAiCredits } from "./format-ai-credits.js";

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
