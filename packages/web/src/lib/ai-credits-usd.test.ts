// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { aiCreditsToUsd, formatUsd } from "./ai-credits-usd.js";

describe("aiCreditsToUsd", () => {
  it("converts at 1 AI credit = $0.01", () => {
    expect(aiCreditsToUsd(100)).toBeCloseTo(1);
    expect(aiCreditsToUsd(1.225)).toBeCloseTo(0.01225);
  });
});

describe("formatUsd", () => {
  it("shows up to 4 decimals, at least 2", () => {
    expect(formatUsd(0.0123)).toBe("$0.0123");
    expect(formatUsd(0.01226)).toBe("$0.0123");
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatUsd(0.1)).toBe("$0.10");
  });

  it("shows $0.00 for zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("does not round a tiny non-zero cost down to $0.00", () => {
    expect(formatUsd(0.00004)).toBe("<$0.0001");
  });
});
