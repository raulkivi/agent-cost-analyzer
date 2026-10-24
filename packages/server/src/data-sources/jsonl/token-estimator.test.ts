import { describe, expect, it } from "vitest";
import { estimateTokenCount } from "./token-estimator.js";

describe("estimateTokenCount", () => {
  it("returns a known, estimated TokenCount holding the o200k_base token count of the given text", () => {
    expect(estimateTokenCount("You are an expert AI programming assistant.")).toEqual({
      known: true,
      value: 8,
      estimated: true,
    });
  });

  it("returns zero tokens (still estimated) for an empty string", () => {
    expect(estimateTokenCount("")).toEqual({
      known: true,
      value: 0,
      estimated: true,
    });
  });
});
