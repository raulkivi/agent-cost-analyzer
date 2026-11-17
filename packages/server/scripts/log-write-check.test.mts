// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { appendFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareLogs, statLogs } from "./log-write-check.mjs";

const START = Date.parse("2026-11-17T10:00:00Z");

describe("compareLogs (the read-only rule beside live sessions)", () => {
  const stat = (size: number, minutes: number) => ({ size, mtimeMs: START + minutes * 60_000 });
  const before = new Map([
    ["a", stat(10, -30)],
    ["b", stat(10, -30)],
    ["c", stat(10, -30)],
    ["d", stat(10, -30)],
  ]);

  it("counts a log written after the run began as its own session's write, not a failure", () => {
    const after = new Map([
      ["a", stat(10, -30)],
      ["b", stat(40, 5)],
      ["c", stat(10, -30)],
      ["d", stat(10, -30)],
    ]);
    expect(compareLogs(before, after, START)).toEqual({ unchanged: 3, writtenDuringRun: 1, violations: [] });
  });

  it("fails a vanished log and a change with no later write time", () => {
    const after = new Map([
      ["a", stat(11, -30)],
      ["b", stat(10, -20)],
      ["c", stat(10, -30)],
    ]);
    const report = compareLogs(before, after, START, (file) => `log ${file}`);
    expect(report.unchanged).toBe(1);
    expect(report.violations.sort()).toEqual(["log a changed without a write time after the run began", "log b changed without a write time after the run began", "log d vanished"]);
  });
});

describe("statLogs", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("records size and write time, and skips a file that is not there", () => {
    dir = mkdtempSync(path.join(tmpdir(), "log-write-"));
    const file = path.join(dir, "x.jsonl");
    writeFileSync(file, "abc");
    utimesSync(file, new Date(START), new Date(START));
    expect(statLogs([file, path.join(dir, "gone")])).toEqual(new Map([[file, { size: 3, mtimeMs: START }]]));
    appendFileSync(file, "d");
    expect(statLogs([file]).get(file)!.size).toBe(4);
  });
});
