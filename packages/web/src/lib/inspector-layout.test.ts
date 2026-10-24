import { describe, expect, it } from "vitest";
import { inspectorLayout } from "./inspector-layout.js";

// Step 10.11: the system prompt inspector's three columns (structure, text,
// description) only fit a wide panel; narrower ones stack them.
describe("inspectorLayout", () => {
  it.each([
    [1600, "wide"],
    [1100, "wide"],
    [1099, "medium"],
    [760, "medium"],
    [759, "narrow"],
    [360, "narrow"],
  ] as const)("lays out a %i px inspector as %s", (width, layout) => {
    expect(inspectorLayout(width).layout).toBe(layout);
  });

  it("lets the text column shrink, so a long line can't widen the page", () => {
    for (const width of [1600, 900, 500]) {
      expect(inspectorLayout(width).columns).toContain("minmax(0, 1fr)");
    }
  });

  it("puts the description under the structure and text when there is no room for a third column", () => {
    expect(inspectorLayout(1200).descriptionSpansRow).toBe(false);
    expect(inspectorLayout(900).descriptionSpansRow).toBe(true);
    expect(inspectorLayout(600).descriptionSpansRow).toBe(true);
  });

  it("treats an unmeasured width as wide", () => {
    expect(inspectorLayout(undefined).layout).toBe("wide");
  });
});
