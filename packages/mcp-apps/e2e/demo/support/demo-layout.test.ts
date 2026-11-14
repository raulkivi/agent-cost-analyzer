// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { DEMO_SCALE, DEMO_VIEW_FRAME_SELECTOR, DEMO_VIEW_WIDTH, demoLayoutCss, frameMismatch } from "./demo-layout.js";

describe("demoLayoutCss", () => {
  const css = demoLayoutCss();

  it("shows only the view shown last", () => {
    expect(css).toContain(`${DEMO_VIEW_FRAME_SELECTOR}:not(:last-of-type) { display: none !important; }`);
  });

  it("lets the view fill the window's height, at the width the view's card has, centred, with no host padding or scrollbar", () => {
    expect(css).toMatch(/body \{[^}]*margin: 0[^}]*padding: 0[^}]*overflow: hidden/);
    expect(css).toMatch(/#chat \{[^}]*align-items: center/);
    expect(css).toContain(`width: ${DEMO_VIEW_WIDTH}px !important`);
    expect(css).toMatch(/height: 100vh !important/);
  });
});

describe("frameMismatch", () => {
  const frame = { width: 1600, height: 1000 };

  it("accepts a window that fills the frame at the demo scale", () => {
    expect(frameMismatch({ innerWidth: 1600 / DEMO_SCALE, innerHeight: 1000 / DEMO_SCALE, devicePixelRatio: DEMO_SCALE, screenX: 0, screenY: 0 }, frame)).toBeUndefined();
  });

  it("names a window that is the wrong size, offset, or at another scale", () => {
    expect(frameMismatch({ innerWidth: 1200, innerHeight: 800, devicePixelRatio: DEMO_SCALE, screenX: 0, screenY: 0 }, frame)).toContain("1380x920");
    expect(frameMismatch({ innerWidth: 1600 / DEMO_SCALE, innerHeight: 1000 / DEMO_SCALE, devicePixelRatio: 1, screenX: 0, screenY: 0 }, frame)).toContain("scale");
    expect(frameMismatch({ innerWidth: 1600 / DEMO_SCALE, innerHeight: 1000 / DEMO_SCALE, devicePixelRatio: DEMO_SCALE, screenX: 10, screenY: 0 }, frame)).toContain("0,0");
  });
});
