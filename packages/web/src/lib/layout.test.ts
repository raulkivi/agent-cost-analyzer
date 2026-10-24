import { describe, expect, it } from "vitest";
import { layoutFor, MIN_SUPPORTED_WIDTH } from "./layout.js";

// vscode-extension.md §3.5 Layout: by the panel's width, not the window's.
describe("layoutFor", () => {
  it.each([
    [360, "narrow"],
    [640, "narrow"],
    [699, "narrow"],
    [700, "medium"],
    [900, "medium"],
    [1099, "medium"],
    [1100, "wide"],
    [1280, "wide"],
  ] as const)("lays out a %i px panel as %s", (width, layout) => {
    expect(layoutFor(width)).toBe(layout);
  });

  it("supports panels down to 360 px; narrower ones get the narrow layout too", () => {
    expect(MIN_SUPPORTED_WIDTH).toBe(360);
    expect(layoutFor(200)).toBe("narrow");
  });

  it("treats an unmeasured width (undefined, or 0 before layout) as wide, today's layout", () => {
    expect(layoutFor(undefined)).toBe("wide");
    expect(layoutFor(0)).toBe("wide");
  });
});
