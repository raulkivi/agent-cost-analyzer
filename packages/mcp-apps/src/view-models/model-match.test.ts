// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { sameModel } from "./model-match.js";

describe("sameModel", () => {
  it.each([
    ["claude-sonnet-5.5", "claude-sonnet-5.5"],
    ["claude-sonnet-5-5-20261001", "claude-sonnet-5.5"], // Claude Code's spelling: hyphenated version and a date
    ["claude-sonnet-5-5", "claude-sonnet-5.5"],
    ["copilot/claude-sonnet-5.5", "claude-sonnet-5.5"],
    ["claude-sonnet-5.5[1m]", "claude-sonnet-5.5"],
    ["Claude Sonnet 5.5", "claude-sonnet-5.5"],
    ["GPT-5.5", "gpt-5.5"],
  ])("reads %s and %s as one model", (logged, priced) => {
    expect(sameModel(logged, priced)).toBe(true);
    expect(sameModel(priced, logged)).toBe(true);
  });

  it.each([
    ["claude-sonnet-5.5", "claude-opus-5.5"],
    ["claude-sonnet-5.5", "claude-sonnet-5.4"],
    ["gpt-5.5", "gpt-5.5-mini"],
    ["", "claude-sonnet-5.5"],
    ["unknown", "unknown-model"],
  ])("does not guess %s is %s", (a, b) => {
    expect(sameModel(a, b)).toBe(false);
  });
});
