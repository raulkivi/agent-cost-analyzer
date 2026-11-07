import { describe, expect, it } from "vitest";
import { openSessionCommand } from "./open-command.js";

describe("openSessionCommand", () => {
  it("is the Command Palette text the owner approved (plan §4.4)", () => {
    expect(openSessionCommand("7f3a9c2e")).toBe("AI Credits Analyzer: Open Session 7f3a9c2e");
  });
});
