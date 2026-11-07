// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { findCompactedRequestIds, isCompactBoundary } from "./compaction.js";
import type { ClaudeCodeTurnGroup } from "./turn-grouper.js";

function user(uuid: string): ClaudeCodeRawEntry {
  return { type: "user", uuid, message: { role: "user", content: "made-up prompt" } };
}
function assistant(uuid: string, id: string, model = "claude-sonnet-5-5"): ClaudeCodeRawEntry {
  return { type: "assistant", uuid, message: { id, model, role: "assistant", content: [] } };
}
function boundary(uuid: string): ClaudeCodeRawEntry {
  return { type: "system", subtype: "compact_boundary", uuid, parentUuid: null, logicalParentUuid: "x", compactMetadata: { trigger: "auto", preTokens: 900 } };
}
function summary(uuid: string): ClaudeCodeRawEntry {
  return { type: "user", uuid, isCompactSummary: true, message: { role: "user", content: "Made-up summary." } };
}
function group(...entries: ClaudeCodeRawEntry[]): ClaudeCodeTurnGroup {
  return { userMessageEntry: entries[0]!, entries };
}

describe("isCompactBoundary", () => {
  it("is true only for a system compact_boundary entry", () => {
    expect(isCompactBoundary(boundary("b1"))).toBe(true);
    expect(isCompactBoundary({ type: "system", subtype: "stop_hook_summary", uuid: "s1" })).toBe(false);
    expect(isCompactBoundary(summary("cs1"))).toBe(false);
  });
});

describe("findCompactedRequestIds", () => {
  it("names the first request after a compaction between turns, in the next turn", () => {
    const ids = findCompactedRequestIds([
      group(user("u1"), assistant("a1", "m1"), boundary("b1"), summary("cs1")),
      group(user("u2"), assistant("a2", "m2"), assistant("a3", "m2"), assistant("a4", "m3")),
    ]);

    expect(ids).toEqual(new Set(["m2"]));
  });

  it("names the first request after a compaction in the middle of a turn", () => {
    const ids = findCompactedRequestIds([group(user("u1"), assistant("a1", "m1"), boundary("b1"), summary("cs1"), assistant("a2", "m2"))]);

    expect(ids).toEqual(new Set(["m2"]));
  });

  it("skips synthetic entries and turns with no request, naming the next real request", () => {
    const ids = findCompactedRequestIds([
      group(user("u1"), assistant("a1", "m1"), boundary("b1")),
      group(user("u2")),
      group(user("u3"), assistant("s1", "syn", "<synthetic>"), assistant("a2", "m2")),
    ]);

    expect(ids).toEqual(new Set(["m2"]));
  });

  it("names one request per compaction, and none when no request follows", () => {
    const ids = findCompactedRequestIds([
      group(user("u1"), assistant("a1", "m1"), boundary("b1")),
      group(user("u2"), assistant("a2", "m2"), boundary("b2")),
      group(user("u3"), assistant("a3", "m3"), boundary("b3")),
    ]);

    expect(ids).toEqual(new Set(["m2", "m3"]));
  });

  it("ignores a later block of a response that began before the compaction", () => {
    const ids = findCompactedRequestIds([group(user("u1"), assistant("a1", "m1"), boundary("b1"), assistant("a2", "m1"), assistant("a3", "m2"))]);

    expect(ids).toEqual(new Set(["m2"]));
  });
});
