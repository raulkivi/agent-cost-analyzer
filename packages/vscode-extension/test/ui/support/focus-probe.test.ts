// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { hasVisibleFocusIndicator } from "./focus-probe.js";

const NONE = { outlineStyle: "none", outlineWidth: "0px", boxShadow: "none" };

describe("hasVisibleFocusIndicator (check 1.7)", () => {
  it("accepts a solid outline with width", () => {
    expect(hasVisibleFocusIndicator({ ...NONE, outlineStyle: "solid", outlineWidth: "1px" })).toBe(true);
  });

  it("accepts a box shadow", () => {
    expect(hasVisibleFocusIndicator({ ...NONE, boxShadow: "rgb(0, 127, 212) 0px 0px 0px 2px" })).toBe(true);
  });

  it("rejects no outline and no shadow", () => {
    expect(hasVisibleFocusIndicator(NONE)).toBe(false);
  });

  it("rejects an outline of style none or zero width", () => {
    expect(hasVisibleFocusIndicator({ ...NONE, outlineStyle: "none", outlineWidth: "1px" })).toBe(false);
    expect(hasVisibleFocusIndicator({ ...NONE, outlineStyle: "solid", outlineWidth: "0px" })).toBe(false);
  });

  it("rejects an empty shadow value", () => {
    expect(hasVisibleFocusIndicator({ ...NONE, boxShadow: "" })).toBe(false);
  });
});
