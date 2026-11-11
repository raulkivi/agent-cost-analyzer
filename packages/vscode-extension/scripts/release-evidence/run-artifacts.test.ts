// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendRunLog, readRunArtifacts, writeWorkerResults } from "./run-artifacts.mts";

describe("run artifacts (what the workers leave for the launcher to record)", () => {
  let dir: string;

  beforeEach(() => {
    dir = path.join(mkdtempSync(path.join(tmpdir(), "aica-evidence-run-")), "evidence");
  });

  afterEach(() => {
    rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  it("reads nothing from a run that left nothing (the spec never loaded)", () => {
    expect(readRunArtifacts(dir)).toEqual({ results: [], log: [] });
  });

  it("collects every worker's results, in worker order, and the run log in append order", () => {
    writeWorkerResults(dir, "0-1", [{ title: "2.3 b", parent: "S", state: "failed" }]);
    writeWorkerResults(dir, "0-0", [{ title: "1.4 a", parent: "S", state: "passed" }]);
    appendRunLog(dir, { kind: "observed-model", model: "m1" });
    appendRunLog(dir, { kind: "skip", scope: "test", title: "2.3 b", reason: "r" });

    expect(readRunArtifacts(dir)).toEqual({
      results: [
        { title: "1.4 a", parent: "S", state: "passed" },
        { title: "2.3 b", parent: "S", state: "failed" },
      ],
      log: [
        { kind: "observed-model", model: "m1" },
        { kind: "skip", scope: "test", title: "2.3 b", reason: "r" },
      ],
    });
  });

  it("refuses a results file that isn't a list of test results", () => {
    writeWorkerResults(dir, "0-0", []);
    writeFileSync(path.join(dir, "results-0-0.json"), '[{"title":"x"}]');
    expect(() => readRunArtifacts(dir)).toThrow(/results-0-0\.json/);
  });
});
