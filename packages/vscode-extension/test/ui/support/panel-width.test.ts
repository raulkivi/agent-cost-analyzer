import { describe, expect, it } from "vitest";
import { isWithinTolerance, windowWidthFor } from "./panel-width.js";

describe("windowWidthFor (check 1.9)", () => {
  it("adds the chrome around the webview, measured at another window width", () => {
    // 1600 px window, 1300 px webview: 300 px of chrome.
    expect(windowWidthFor(640, { windowWidth: 1600, webviewWidth: 1300 })).toBe(940);
  });

  it("works for any measuring width", () => {
    expect(windowWidthFor(360, { windowWidth: 1000, webviewWidth: 700 })).toBe(660);
  });

  it("refuses a measurement where the webview is wider than the window", () => {
    expect(() => windowWidthFor(360, { windowWidth: 800, webviewWidth: 900 })).toThrow(/wider than the window/);
  });
});

describe("isWithinTolerance", () => {
  it("accepts the target and 8 px either side", () => {
    expect(isWithinTolerance(640, 640)).toBe(true);
    expect(isWithinTolerance(632, 640)).toBe(true);
    expect(isWithinTolerance(648, 640)).toBe(true);
  });

  it("rejects beyond", () => {
    expect(isWithinTolerance(631, 640)).toBe(false);
    expect(isWithinTolerance(649, 640)).toBe(false);
  });
});
