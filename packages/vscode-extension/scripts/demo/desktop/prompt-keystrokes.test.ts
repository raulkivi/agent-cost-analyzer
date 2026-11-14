// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { promptKeystrokes } from "./prompt-keystrokes.mts";

describe("promptKeystrokes", () => {
  it("builds an argv array with the pacing delay", () => {
    expect(promptKeystrokes("What did my agents cost?", 60)).toEqual([
      "type", "--delay", "60", "--clearmodifiers", "--", "What did my agents cost?",
    ]);
  });
  it("keeps shell metacharacters and a leading dash in one argument", () => {
    const argv = promptKeystrokes(`-x "$HOME"; rm -rf *`, 40);
    expect(argv.at(-1)).toBe(`-x "$HOME"; rm -rf *`);
    expect(argv.at(-2)).toBe("--");
  });
  it("rejects a bad delay", () => {
    expect(() => promptKeystrokes("a", -1)).toThrow(/delay/);
    expect(() => promptKeystrokes("a", 1.5)).toThrow(/delay/);
  });
  it("rejects empty text", () => {
    expect(() => promptKeystrokes("", 60)).toThrow(/empty/);
  });
});
