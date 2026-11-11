// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { VSCODE_SETS } from "./host-sets.js";

describe("VSCODE_SETS", () => {
  const named = (fragment: string) => VSCODE_SETS.find((set) => set.name.includes(fragment));

  it("lists Light and Dark Modern and both High Contrast themes", () => {
    for (const fragment of ["Light Modern", "Dark Modern", "Dark High Contrast", "Light High Contrast"]) expect(named(fragment), fragment).toBeDefined();
  });

  it("takes the High Contrast colours from the recordings", () => {
    expect(named("Dark High Contrast")?.hostVars["--vscode-editor-background"]).toBe("#000000");
    // The recorded Light High Contrast ground is white and its text near black.
    expect(named("Light High Contrast")?.hostVars["--vscode-editor-background"]).toBe("#ffffff");
    expect(named("Light High Contrast")?.hostVars["--vscode-foreground"]).toBe("#292929");
  });

  it("applies the light document theme to Light High Contrast and the dark one to Dark", () => {
    expect(named("Light High Contrast")?.theme).toBe("light");
    expect(named("Dark High Contrast")?.theme).toBe("dark");
  });
});
