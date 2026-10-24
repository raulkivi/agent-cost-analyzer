import { describe, expect, it } from "vitest";
import {
  estimatedTokenCount,
  sumTokenCounts,
  tokenCountSchema,
  unavailableTokenCount,
} from "./token-count.js";

describe("tokenCountSchema", () => {
  it("accepts a known token count", () => {
    const sample = { known: true, value: 42 };

    expect(tokenCountSchema.parse(sample)).toEqual(sample);
  });

  it("accepts a known token count carrying the optional estimated flag", () => {
    const sample = { known: true, value: 42, estimated: true };

    expect(tokenCountSchema.parse(sample)).toEqual(sample);
  });

  it("accepts an unknown token count with a reason", () => {
    const sample = { known: false, reason: "main.jsonl parsing not yet implemented" };

    expect(tokenCountSchema.parse(sample)).toEqual(sample);
  });

  it("rejects a known token count missing a value", () => {
    expect(() => tokenCountSchema.parse({ known: true })).toThrow();
  });

  it("rejects an unknown token count missing a reason", () => {
    expect(() => tokenCountSchema.parse({ known: false })).toThrow();
  });
});

describe("unavailableTokenCount", () => {
  it("builds a known:false TokenCount carrying the given reason", () => {
    expect(unavailableTokenCount("not recorded")).toEqual({
      known: false,
      reason: "not recorded",
    });
  });
});

describe("estimatedTokenCount", () => {
  it("builds a known:true TokenCount flagged as estimated", () => {
    expect(estimatedTokenCount(123)).toEqual({
      known: true,
      value: 123,
      estimated: true,
    });
  });
});

describe("sumTokenCounts", () => {
  it("sums known values", () => {
    const counts = [
      { known: true as const, value: 1.5 },
      { known: true as const, value: 2.25 },
    ];

    expect(sumTokenCounts(counts, "unused")).toEqual({ known: true, value: 3.75 });
  });

  it("returns known:true value:0 for an empty list", () => {
    expect(sumTokenCounts([], "unused")).toEqual({ known: true, value: 0 });
  });

  it("returns unavailable with the given reason when any count is unknown", () => {
    const counts = [
      { known: true as const, value: 1 },
      { known: false as const, reason: "not exposed" },
      { known: true as const, value: 2 },
    ];

    expect(sumTokenCounts(counts, "total unavailable")).toEqual({
      known: false,
      reason: "total unavailable",
    });
  });
});
