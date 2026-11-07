import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { groupBranchEntriesByUserMessage, isRealUserMessage } from "./turn-grouper.js";

function realUserMessage(uuid: string, text = "hi"): ClaudeCodeRawEntry {
  return { type: "user", uuid, message: { role: "user", content: [{ type: "text", text }] } };
}
function toolResultUserMessage(uuid: string, toolUseId: string): ClaudeCodeRawEntry {
  return {
    type: "user",
    uuid,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }] },
  };
}
function assistantEntry(uuid: string): ClaudeCodeRawEntry {
  return { type: "assistant", uuid, message: { id: "m1", role: "assistant", content: [{ type: "text", text: "hey" }] } };
}
function attachmentEntry(uuid: string): ClaudeCodeRawEntry {
  return { type: "attachment", uuid };
}
// The CLI's own text injected as a `user` line (a command caveat, a skill's
// body), flagged isMeta — seen with string and text-block content.
function metaUserMessage(uuid: string, content: unknown = "<caveat>made-up note</caveat>"): ClaudeCodeRawEntry {
  return { type: "user", uuid, isMeta: true, message: { role: "user", content } };
}
// The summary a compaction writes right after its compact_boundary entry.
function compactSummaryMessage(uuid: string): ClaudeCodeRawEntry {
  return { type: "user", uuid, isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: "user", content: "Made-up summary of the earlier work." } };
}
function compactBoundary(uuid: string): ClaudeCodeRawEntry {
  return { type: "system", subtype: "compact_boundary", uuid, parentUuid: null, logicalParentUuid: "a1" };
}

describe("isRealUserMessage", () => {
  it("is true for a user entry with text content", () => {
    expect(isRealUserMessage(realUserMessage("u1"))).toBe(true);
  });

  it("is false for a user entry whose content is purely tool_result blocks", () => {
    expect(isRealUserMessage(toolResultUserMessage("u1", "call-1"))).toBe(false);
  });

  it("is false for a non-user entry", () => {
    expect(isRealUserMessage(assistantEntry("a1"))).toBe(false);
    expect(isRealUserMessage(attachmentEntry("x1"))).toBe(false);
  });

  it("is true for a user entry whose content is a plain string", () => {
    expect(isRealUserMessage({ type: "user", uuid: "u1", message: { role: "user", content: "hi" } })).toBe(true);
  });

  it("is false for an isMeta user entry, with string or text-block content", () => {
    expect(isRealUserMessage(metaUserMessage("m1"))).toBe(false);
    expect(isRealUserMessage(metaUserMessage("m2", [{ type: "text", text: "made-up skill body" }]))).toBe(false);
  });

  it("is false for a compaction's summary entry", () => {
    expect(isRealUserMessage(compactSummaryMessage("cs1"))).toBe(false);
  });
});

describe("groupBranchEntriesByUserMessage", () => {
  it("groups everything up to (not including) the next real user message into one turn", () => {
    const entries = [realUserMessage("u1"), assistantEntry("a1"), realUserMessage("u2"), assistantEntry("a2")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups).toHaveLength(2);
    expect(groups[0].userMessageEntry.uuid).toBe("u1");
    expect(groups[0].entries.map((e) => e.uuid)).toEqual(["u1", "a1"]);
    expect(groups[1].userMessageEntry.uuid).toBe("u2");
    expect(groups[1].entries.map((e) => e.uuid)).toEqual(["u2", "a2"]);
  });

  it("does not start a new turn on a tool-result-delivery 'user' entry", () => {
    const entries = [realUserMessage("u1"), assistantEntry("a1"), toolResultUserMessage("tr1", "call-1"), assistantEntry("a2")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.uuid)).toEqual(["u1", "a1", "tr1", "a2"]);
  });

  it("attributes a non-message entry (e.g. attachment) to the turn whose span it falls within", () => {
    const entries = [realUserMessage("u1"), attachmentEntry("att1"), assistantEntry("a1")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.uuid)).toEqual(["u1", "att1", "a1"]);
  });

  it("drops entries that precede the first real user message", () => {
    const entries = [attachmentEntry("att0"), realUserMessage("u1"), assistantEntry("a1")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.uuid)).toEqual(["u1", "a1"]);
  });

  it("keeps an isMeta entry inside the turn it falls in, so one response is never split across two turns", () => {
    const entries = [realUserMessage("u1"), assistantEntry("a1"), metaUserMessage("meta1"), assistantEntry("a2")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.uuid)).toEqual(["u1", "a1", "meta1", "a2"]);
  });

  it("keeps a compaction's boundary and summary in the turn before it; the next real user message opens the next turn", () => {
    const entries = [realUserMessage("u1"), assistantEntry("a1"), compactBoundary("b1"), compactSummaryMessage("cs1"), realUserMessage("u2"), assistantEntry("a2")];

    const groups = groupBranchEntriesByUserMessage(entries);

    expect(groups.map((g) => g.userMessageEntry.uuid)).toEqual(["u1", "u2"]);
    expect(groups[0].entries.map((e) => e.uuid)).toEqual(["u1", "a1", "b1", "cs1"]);
    expect(groups[1].entries.map((e) => e.uuid)).toEqual(["u2", "a2"]);
  });

  it("returns an empty array for an empty branch", () => {
    expect(groupBranchEntriesByUserMessage([])).toEqual([]);
  });
});
