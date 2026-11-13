// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dropSavedWindowState, frameProblem, mastersDir } from "./demo-launch.mts";

describe("frameProblem", () => {
  it("accepts a window within a few pixels of the frame", () => {
    expect(frameProblem({ x: 0, y: 0, width: 1200, height: 800 })).toBeUndefined();
    expect(frameProblem({ x: 0, y: 0, width: 1199, height: 799 })).toBeUndefined();
  });

  it("rejects a window that is shifted, as a restored profile opens it", () => {
    expect(frameProblem({ x: 10, y: 10, width: 1199, height: 799 })).toMatch(/at 10,10/);
  });

  it("names the Xvfb size to use when the window is another size", () => {
    expect(frameProblem({ x: 0, y: 0, width: 1600, height: 1000 })).toMatch(/1600x1000.*-screen 0 1200x800x24/);
  });
});

describe("mastersDir", () => {
  it("honours AICA_DEMO_MASTERS, else <repo root>/demo-masters", () => {
    expect(mastersDir({ AICA_DEMO_MASTERS: "/x/m" })).toBe("/x/m");
    expect(mastersDir({})).toMatch(/\/demo-masters$/);
  });
});

describe("dropSavedWindowState", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "aica-demo-launch-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("removes the window and splash state and keeps the rest", () => {
    const file = path.join(dir, "storage.json");
    writeFileSync(file, JSON.stringify({ windowsState: { lastActiveWindow: {} }, windowSplash: {}, "telemetry.machineId": "m" }));
    dropSavedWindowState(file);
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ "telemetry.machineId": "m" });
  });

  it("does nothing when there is no storage.json", () => {
    expect(() => dropSavedWindowState(path.join(dir, "missing.json"))).not.toThrow();
  });
});
