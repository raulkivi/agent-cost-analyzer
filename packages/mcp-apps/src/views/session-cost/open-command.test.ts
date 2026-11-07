// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { OPEN_SESSION_COMMAND_TITLE, sessionSearchText } from "./open-command.js";

// Owner decision A (plan §4.4): the button copies the session title, which
// the user pastes into the "Open Session…" picker in the Command Palette.
describe("sessionSearchText", () => {
  it("is the session title, so the picker filters to that session", () => {
    expect(sessionSearchText("7f3a9c2e", "Refactor the billing exporter")).toBe("Refactor the billing exporter");
  });

  it("folds line breaks, tabs and runs of spaces into one space, and trims", () => {
    expect(sessionSearchText("7f3a9c2e", "  Fix\n\tthe   parser \r\n")).toBe("Fix the parser");
  });

  it("drops control characters", () => {
    expect(sessionSearchText("7f3a9c2e", "Fix\u0000 the\u001b parser\u007f")).toBe("Fix the parser");
  });

  it("caps a long title at 120 characters, which still filters the picker", () => {
    expect(sessionSearchText("7f3a9c2e", "x".repeat(500))).toHaveLength(120);
  });

  it("falls back to the session id when the title is empty or only whitespace", () => {
    expect(sessionSearchText("7f3a9c2e", "")).toBe("7f3a9c2e");
    expect(sessionSearchText("7f3a9c2e", " \n\t ")).toBe("7f3a9c2e");
  });
});

describe("OPEN_SESSION_COMMAND_TITLE", () => {
  it("is the palette title the extension contributes (package.nls.json)", () => {
    expect(OPEN_SESSION_COMMAND_TITLE).toBe("AI Credits Analyzer: Open Session…");
  });
});
