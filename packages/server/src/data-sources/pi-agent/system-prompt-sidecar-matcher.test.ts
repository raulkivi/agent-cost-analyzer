// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import { branchEndTimestamp, selectSidecarRecord } from "./system-prompt-sidecar-matcher.js";
import type { PiSystemPromptSidecarRecord } from "./system-prompt-sidecar-reader.js";

function rec(capturedAt: string, systemPrompt = capturedAt): PiSystemPromptSidecarRecord {
  return { sessionId: "s", capturedAt, cwd: "/p", systemPrompt, systemPromptChars: systemPrompt.length };
}

describe("branchEndTimestamp", () => {
  it("returns the latest entry timestamp on the branch", () => {
    const branch: PiRawEntry[] = [
      { type: "message", id: "a", timestamp: "2026-10-01T10:00:00.000Z" },
      { type: "message", id: "b", timestamp: "2026-10-01T10:05:00.000Z" },
      { type: "message", id: "c" },
    ];
    expect(branchEndTimestamp(branch)).toBe("2026-10-01T10:05:00.000Z");
  });

  it("is undefined when no entry has a parsable timestamp", () => {
    expect(branchEndTimestamp([{ type: "message", id: "a", timestamp: "nope" }])).toBeUndefined();
  });
});

describe("selectSidecarRecord", () => {
  const early = rec("2026-10-01T10:00:00.000Z");
  const mid = rec("2026-10-01T11:00:00.000Z");
  const late = rec("2026-10-01T12:00:00.000Z");

  it("returns undefined without records", () => {
    expect(selectSidecarRecord(undefined, "2026-10-01T11:00:00.000Z")).toBeUndefined();
    expect(selectSidecarRecord([], "2026-10-01T11:00:00.000Z")).toBeUndefined();
  });

  it("picks the latest record captured at or before the branch's end", () => {
    expect(selectSidecarRecord([early, mid, late], "2026-10-01T11:30:00.000Z")).toBe(mid);
    expect(selectSidecarRecord([early, mid, late], "2026-10-01T11:00:00.000Z")).toBe(mid);
  });

  it("ignores records captured after the branch ended when an earlier one exists", () => {
    expect(selectSidecarRecord([early, late], "2026-10-01T10:30:00.000Z")).toBe(early);
  });

  it("falls back to the earliest record when every record is later than the branch end", () => {
    expect(selectSidecarRecord([mid, late], "2026-10-01T10:00:00.000Z")).toBe(mid);
  });

  it("falls back to the earliest record when the branch has no timestamp", () => {
    expect(selectSidecarRecord([early, mid], undefined)).toBe(early);
  });

  it("does not depend on the input order", () => {
    expect(selectSidecarRecord([late, early, mid], "2026-10-01T11:30:00.000Z")).toBe(mid);
  });
});
