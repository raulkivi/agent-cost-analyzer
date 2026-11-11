// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { withoutStop } from "./sentence.js";

describe("withoutStop", () => {
  it.each([
    ["it can be issued from 2026-12-01.", "it can be issued from 2026-12-01"],
    ["no stop", "no stop"],
    ["  spaced.. ", "spaced"],
    ["", ""],
  ])("%j -> %j", (input, output) => {
    expect(withoutStop(input)).toBe(output);
  });
});
