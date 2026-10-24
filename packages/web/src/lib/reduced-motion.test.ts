import { describe, expect, it } from "vitest";
import { prefersReducedMotion, scrollBehavior } from "./reduced-motion.js";

function media(reduce: boolean) {
  return { matchMedia: (query: string) => ({ matches: reduce && query === "(prefers-reduced-motion: reduce)" }) };
}

describe("reduced motion", () => {
  it("reads the user's prefers-reduced-motion setting", () => {
    expect(prefersReducedMotion(media(true))).toBe(true);
    expect(prefersReducedMotion(media(false))).toBe(false);
  });

  it("treats a host without matchMedia (jsdom, old webviews) as no preference", () => {
    expect(prefersReducedMotion({})).toBe(false);
  });

  it("scrolls instantly when reduced motion is on, smoothly otherwise", () => {
    expect(scrollBehavior(media(true))).toBe("auto");
    expect(scrollBehavior(media(false))).toBe("smooth");
  });
});
