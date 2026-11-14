// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parseDesktopArgs } from "./desktop-args.mts";

describe("parseDesktopArgs", () => {
  it("takes a scene id", () => {
    expect(parseDesktopArgs(["M1"])).toEqual({ scene: "M1", dryRun: false });
  });
  it("takes --dry-run without a scene", () => {
    expect(parseDesktopArgs(["--dry-run"])).toEqual({ scene: undefined, dryRun: true });
  });
  it("rejects a missing scene outside a dry run", () => {
    expect(() => parseDesktopArgs([])).toThrow(/scene/);
  });
  it("rejects unknown flags and extra arguments", () => {
    expect(() => parseDesktopArgs(["M1", "--wat"])).toThrow(/--wat/);
    expect(() => parseDesktopArgs(["M1", "M2"])).toThrow(/one scene/);
  });
});
