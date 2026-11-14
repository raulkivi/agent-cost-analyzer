// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { contextEditFor, latestContextEdits } from "./context-edits.js";
import type { PiRawEntry } from "./pi-jsonl-reader.js";

const edit = (id: string, targetId: unknown, replacement: unknown): PiRawEntry => ({ type: "context_edit", id, targetId, replacement });

describe("latestContextEdits", () => {
  it("keeps the latest edit per target on the branch (docs/session-format.md ContextEditEntry)", () => {
    const edits = latestContextEdits([
      { type: "message", id: "a1", message: { role: "assistant" } },
      edit("e1", "a1", "first replacement"),
      edit("e2", "a1", null),
      edit("e3", "t1", [{ type: "text", text: "short" }]),
    ]);

    expect(edits.get("a1")).toEqual({ replacement: null });
    expect(edits.get("t1")).toEqual({ replacement: [{ type: "text", text: "short" }] });
    expect(edits.size).toBe(2);
  });

  it("ignores edits without a string targetId", () => {
    expect(latestContextEdits([edit("e1", 5, null), edit("e2", undefined, null)]).size).toBe(0);
  });
});

describe("contextEditFor", () => {
  it("describes an omission and a replacement, saying usage still counts", () => {
    expect(contextEditFor({ replacement: null }, "response")).toEqual({
      kind: "omitted",
      note: expect.stringMatching(/left this response out of the model's context.*still count/i),
    });
    expect(contextEditFor({ replacement: "x" }, "tool result")).toEqual({
      kind: "replaced",
      note: expect.stringMatching(/replaced this tool result.*still count/i),
    });
  });
});
