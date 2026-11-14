// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dropSavedWindowState, fitWindowCommand, frameProblem, mastersDir, stillPath } from "./demo-launch.mts";

describe("fitWindowCommand", () => {
  // Without a window manager VS Code opens a fixed-size window; any X client may resize it.
  it("runs the X11 fit script with the frame size", () => {
    const [command, args] = fitWindowCommand({ width: 1600, height: 1000 });
    expect(command).toBe("python3");
    expect(args[0]).toMatch(/scripts[\\/]demo[\\/]fit-window\.py$/);
    expect(args.slice(1)).toEqual(["1600", "1000"]);
  });
});

describe("frameProblem", () => {
  it("accepts a window within a few pixels of the frame", () => {
    expect(frameProblem({ x: 0, y: 0, width: 1600, height: 1000 })).toBeUndefined();
    expect(frameProblem({ x: 0, y: 0, width: 1599, height: 999 })).toBeUndefined();
  });

  it("rejects a window that is shifted, as a restored profile opens it", () => {
    expect(frameProblem({ x: 10, y: 10, width: 1599, height: 999 })).toMatch(/at 10,10/);
  });

  it("names the Xvfb size to use when the window is another size", () => {
    expect(frameProblem({ x: 0, y: 0, width: 1440, height: 900 })).toMatch(/1440x900.*-screen 0 1600x1000x24/);
  });
});

describe("mastersDir", () => {
  it("honours AICA_DEMO_MASTERS, else <repo root>/demo-masters", () => {
    expect(mastersDir({ AICA_DEMO_MASTERS: "/x/m" })).toBe("/x/m");
    expect(mastersDir({})).toMatch(/\/demo-masters$/);
  });
});

describe("stillPath", () => {
  it("puts a named still in <masters>/stills as a PNG", () => {
    expect(stillPath("sidebar", { AICA_DEMO_MASTERS: "/x/m" })).toBe("/x/m/stills/sidebar.png");
  });

  it("refuses a name that is not a plain file stem", () => {
    expect(() => stillPath("../sidebar", {})).toThrow(/still name/);
    expect(() => stillPath("a.png", {})).toThrow(/still name/);
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
