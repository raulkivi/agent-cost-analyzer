// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_COPILOT_E2E_MODEL, modelMatches, readCopilotE2eEnv } from "./copilot-e2e-env.mts";

describe("readCopilotE2eEnv (opt-in real-Copilot suite)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "aica-e2e-env-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips, naming the switch, unless COPILOT_E2E=1: CI never runs it by accident", () => {
    const result = readCopilotE2eEnv({ COPILOT_E2E_USER_DATA_DIR: dir });

    expect(result).toEqual({ status: "skip", reason: expect.stringContaining("COPILOT_E2E=1") });
  });

  it("skips, naming the variable, when no profile directory is given", () => {
    expect(readCopilotE2eEnv({ COPILOT_E2E: "1" })).toEqual({ status: "skip", reason: expect.stringContaining("COPILOT_E2E_USER_DATA_DIR") });
  });

  it("skips when the profile directory does not exist", () => {
    const result = readCopilotE2eEnv({ COPILOT_E2E: "1", COPILOT_E2E_USER_DATA_DIR: path.join(dir, "missing") });

    expect(result).toEqual({ status: "skip", reason: expect.stringContaining("does not exist") });
  });

  it("runs with the Claude Haiku 5.5 default, and the override when COPILOT_E2E_MODEL is set", () => {
    expect(readCopilotE2eEnv({ COPILOT_E2E: "1", COPILOT_E2E_USER_DATA_DIR: dir })).toEqual({ status: "run", userDataDir: dir, model: DEFAULT_COPILOT_E2E_MODEL });
    expect(DEFAULT_COPILOT_E2E_MODEL).toBe("claude-haiku-5.5");
    expect(readCopilotE2eEnv({ COPILOT_E2E: "1", COPILOT_E2E_USER_DATA_DIR: dir, COPILOT_E2E_MODEL: "gpt-6-luna" })).toMatchObject({ model: "gpt-6-luna" });
  });
});

describe("modelMatches", () => {
  it.each([
    ["claude-haiku-5.5", "claude-haiku-5.5"],
    ["claude-haiku-5.5", "Claude Haiku 5.5"],
    ["claude-haiku-5.5", "claude-haiku-5-5"],
    ["gpt-6-luna", "GPT-6 Luna"],
  ])("accepts %s as %s (case, spaces, dots and dashes are tolerated)", (expected, used) => {
    expect(modelMatches(expected, used)).toBe(true);
  });

  it.each([
    ["claude-haiku-5.5", "gpt-6-luna"],
    ["claude-haiku-5.5", "claude-sonnet-5.5"],
    ["claude-haiku-5.5", ""],
  ])("rejects %s against %s", (expected, used) => {
    expect(modelMatches(expected, used)).toBe(false);
  });
});
