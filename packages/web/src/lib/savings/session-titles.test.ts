// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { InsightSessionRow } from "@agent-cost-analyzer/domain";
import { MAX_TITLE_LENGTH, sessionTitleLookup, titleText } from "./session-titles.js";

// V25 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/savings-increment-3.md §5, D24): titles come from the insights dataset
// rows, keyed providerId:sessionId, and are cleaned before they are shown.

const row = (providerId: string, sessionId: string, title: string) => ({ key: `${providerId}:${sessionId}`, providerId, sessionId, title }) as InsightSessionRow;

describe("sessionTitleLookup", () => {
  const lookup = sessionTitleLookup([row("vscode", "s1", "Fix the build"), row("claude-code", "s1", "Other provider, same id"), row("vscode", "s2", "")]);

  it("finds a title by provider and session id", () => {
    expect(lookup({ providerId: "vscode", sessionId: "s1" })).toBe("Fix the build");
    expect(lookup({ providerId: "claude-code", sessionId: "s1" })).toBe("Other provider, same id");
  });

  it("answers undefined for a session the dataset does not hold", () => {
    expect(lookup({ providerId: "vscode", sessionId: "gone" })).toBeUndefined();
  });

  it("answers undefined for an empty or blank title, so the id shows alone", () => {
    expect(lookup({ providerId: "vscode", sessionId: "s2" })).toBeUndefined();
    expect(sessionTitleLookup([row("vscode", "s3", " \u200f\n ")])({ providerId: "vscode", sessionId: "s3" })).toBeUndefined();
  });

  // An Agent Host session whose title only echoes its first prompt is untitled by design; the dataset
  // names it "Session <id>" (the server's fallback), which would repeat the id as if it were a title.
  it("answers undefined for the fallback title 'Session <id>', so the id shows alone", () => {
    const untitled = sessionTitleLookup([row("vscode", "9a1b-0702", "Session 9a1b-0702"), row("vscode", "s1", "Session notes")]);
    expect(untitled({ providerId: "vscode", sessionId: "9a1b-0702" })).toBeUndefined();
    expect(untitled({ providerId: "vscode", sessionId: "s1" })).toBe("Session notes");
  });

  it("answers undefined for every session when there is no dataset", () => {
    expect(sessionTitleLookup(undefined)({ providerId: "vscode", sessionId: "s1" })).toBeUndefined();
  });

  it("cleans the title it returns", () => {
    const hostile = sessionTitleLookup([row("vscode", "s1", "a\u202eb\nc")]);
    expect(hostile({ providerId: "vscode", sessionId: "s1" })).toBe("ab c");
  });
});

describe("titleText", () => {
  it("folds line breaks and runs of spaces to one line", () => {
    expect(titleText("one\r\ntwo\t\tthree   four")).toBe("one two three four");
  });

  it("removes control and bidi format characters", () => {
    expect(titleText("x\u202ey\u2066z\u0000\u200b")).toBe("xyz");
  });

  it("caps at 120 code points without cutting a surrogate pair", () => {
    const cut = titleText("\u{1F600}".repeat(500));
    expect(MAX_TITLE_LENGTH).toBe(120);
    expect([...cut]).toHaveLength(MAX_TITLE_LENGTH);
    expect(cut).not.toContain("\uFFFD");
  });

  it("leaves markup as text for React to escape, not as something to strip", () => {
    expect(titleText("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
  });
});
