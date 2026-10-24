import { describe, expect, it } from "vitest";
import { layoutFor, LIST_COLUMN_WIDTH, MIN_SUPPORTED_WIDTH } from "./layout.js";

// vscode-extension.md §3.5 Layout: by the room the panel leaves for the
// turns and the right column, not by the window's width. Step 10.11: the
// old thresholds ignored the session list column (and VS Code's own page
// padding), so a "wide" panel overflowed on the right.
describe("layoutFor", () => {
  describe("without a session list column (the extension's Analyze mode: the sidebar lists sessions)", () => {
    it.each([
      [360, "narrow"],
      [511, "narrow"],
      [512, "medium"],
      [800, "medium"],
      [991, "medium"],
      [992, "wide"],
      [1280, "wide"],
    ] as const)("lays out a %i px panel as %s", (width, layout) => {
      expect(layoutFor(width, { listColumn: false })).toBe(layout);
    });
  });

  describe("with a session list column", () => {
    it.each([
      [640, "narrow"],
      [767, "narrow"],
      [768, "medium"],
      [1100, "medium"],
      [1247, "medium"],
      [1248, "wide"],
      [1600, "wide"],
    ] as const)("lays out a %i px panel as %s", (width, layout) => {
      expect(layoutFor(width, { listColumn: true })).toBe(layout);
    });

    it("leaves the turns exactly as much room as without the list", () => {
      expect(layoutFor(800 + LIST_COLUMN_WIDTH + 16, { listColumn: true })).toBe(layoutFor(800, { listColumn: false }));
    });
  });

  it("supports panels down to 360 px; narrower ones get the narrow layout too", () => {
    expect(MIN_SUPPORTED_WIDTH).toBe(360);
    expect(layoutFor(200, { listColumn: false })).toBe("narrow");
  });

  it("treats an unmeasured width (undefined, or 0 before layout) as wide, today's layout", () => {
    expect(layoutFor(undefined, { listColumn: true })).toBe("wide");
    expect(layoutFor(0, { listColumn: true })).toBe("wide");
  });
});
