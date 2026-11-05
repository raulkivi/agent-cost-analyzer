import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompt-builder.js";

describe("buildPrompt (S1)", () => {
  it("orders segments tools → system → messages", () => {
    const prompt = buildPrompt({ tools: 100, system: 50, messages: 20 });
    expect(prompt.segments.map((s) => s.layer)).toEqual([
      "tools",
      "system",
      "messages",
    ]);
  });

  it("makes segments contiguous, each starting where the previous ends", () => {
    const { segments, totalTokens } = buildPrompt({
      tools: 100,
      system: 50,
      messages: 20,
    });
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [0, 100],
      [100, 150],
      [150, 170],
    ]);
    expect(totalTokens).toBe(170);
  });

  it("gives the tokens before a layer", () => {
    const prompt = buildPrompt({ tools: 100, system: 50, messages: 20 });
    expect(prompt.tokensBefore("tools")).toBe(0);
    expect(prompt.tokensBefore("system")).toBe(100);
    expect(prompt.tokensBefore("messages")).toBe(150);
  });
});
