// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRunArtifacts } from "../../../../scripts/release-evidence/run-artifacts.mts";
import { COPILOT_E2E_ROOT_ENV, evidenceDirOf, logToRun, skipSuite, skipTest } from "./run-log.mts";

class Skipped extends Error {}

// The parts of a mocha context the helpers use.
function context(test: { title: string; parent?: { title: string } }) {
  return {
    test,
    skip: vi.fn((): never => {
      throw new Skipped();
    }),
  };
}

describe("run log of the real-Copilot specs (skip reasons, models, AI Credits for G2)", () => {
  let root: string;
  let before: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "aica-run-log-"));
    before = process.env[COPILOT_E2E_ROOT_ENV];
    process.env[COPILOT_E2E_ROOT_ENV] = root;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (before === undefined) delete process.env[COPILOT_E2E_ROOT_ENV];
    else process.env[COPILOT_E2E_ROOT_ENV] = before;
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("skips a test with its reason recorded under the test's title, and prints it", () => {
    const ctx = context({ title: "1.4 a chat" });

    expect(() => skipTest(ctx as unknown as Mocha.Context, "ran gpt-6-luna")).toThrow(Skipped);

    expect(ctx.skip).toHaveBeenCalledOnce();
    expect(readRunArtifacts(evidenceDirOf(root)).log).toEqual([{ kind: "skip", scope: "test", title: "1.4 a chat", reason: "ran gpt-6-luna" }]);
    expect(console.log).toHaveBeenCalledWith("[copilot-e2e] SKIPPED: ran gpt-6-luna");
  });

  it("skips a suite from its setup hook with the reason recorded under the suite's title", () => {
    const ctx = context({ title: '"before all" hook', parent: { title: "Real Copilot" } });

    expect(() => skipSuite(ctx as unknown as Mocha.Context, "not signed in")).toThrow(Skipped);

    expect(readRunArtifacts(evidenceDirOf(root)).log).toEqual([{ kind: "skip", scope: "suite", title: "Real Copilot", reason: "not signed in" }]);
  });

  it("appends other entries in order", () => {
    logToRun({ kind: "observed-model", model: "m" });
    logToRun({ kind: "credits", spent: 0.5 });

    expect(readRunArtifacts(evidenceDirOf(root)).log).toEqual([
      { kind: "observed-model", model: "m" },
      { kind: "credits", spent: 0.5 },
    ]);
  });

  it("writes nothing outside a recorded run (no root set), and still skips", () => {
    delete process.env[COPILOT_E2E_ROOT_ENV];
    const ctx = context({ title: "1.4 a chat" });

    expect(() => skipTest(ctx as unknown as Mocha.Context, "r")).toThrow(Skipped);
    logToRun({ kind: "credits", spent: 1 });

    expect(readRunArtifacts(evidenceDirOf(root))).toEqual({ results: [], log: [] });
  });
});
