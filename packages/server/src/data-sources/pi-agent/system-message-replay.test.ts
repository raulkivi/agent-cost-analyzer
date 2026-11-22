// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import { replaySystemMessages } from "./system-message-replay.js";

function systemMessage(id: string, message: Record<string, unknown>): PiRawEntry {
  return { type: "message", id, message: { role: "system", content: "", timestamp: 0, ...message } };
}
function userMessage(id: string): PiRawEntry {
  return { type: "message", id, message: { role: "user", content: "hi" } };
}
const tool = (name: string) => ({ name, description: `${name} tool`, parameters: { type: "object" } });

// Mirrors pi-ai's getCurrentSystemMessage/getSystemMessageText
// (dist/utils/transcript.js, dist/utils/text.js) and the replay rules in
// docs/session-format.md "SessionMessageEntry" / docs/message-types.md
// "SystemMessage".
describe("replaySystemMessages", () => {
  it("returns null when the branch carries no system message", () => {
    expect(replaySystemMessages([userMessage("u1")])).toBeNull();
  });

  it("renders the leading system message as content followed by its sections", () => {
    const state = replaySystemMessages([
      systemMessage("s0", {
        content: "You are an expert coding assistant.",
        sections: { tools: "<tools>read</tools>", cwd: "cwd: /p" },
        toolsAdded: [tool("read"), tool("bash")],
      }),
      userMessage("u1"),
    ]);

    expect(state).toEqual({
      baseContent: "You are an expert coding assistant.",
      sections: [
        { name: "tools", text: "<tools>read</tools>" },
        { name: "cwd", text: "cwd: /p" },
      ],
      text: "You are an expert coding assistant.\n\n<tools>read</tools>\n\ncwd: /p",
      tools: [tool("read"), tool("bash")],
      declaredToolNames: ["read", "bash"],
      toolHistory: [
        { name: "read", definition: tool("read"), loadedRequests: 0 },
        { name: "bash", definition: tool("bash"), loadedRequests: 0 },
      ],
    });
  });

  it("appends later content, patches sections by name (null removes) and applies tool add/remove", () => {
    const state = replaySystemMessages([
      systemMessage("s0", { content: "Base.", sections: { a: "A1", b: "B1" }, toolsAdded: [tool("read"), tool("write")] }),
      userMessage("u1"),
      systemMessage("s1", { content: [{ type: "text", text: "Extra." }], sections: { a: "A2", b: null, c: "C1" }, toolsRemoved: [{ name: "write" }], toolsAdded: [tool("grep")] }),
    ]);

    expect(state?.baseContent).toBe("Base.\n\nExtra.");
    expect(state?.sections).toEqual([
      { name: "a", text: "A2" },
      { name: "c", text: "C1" },
    ]);
    expect(state?.text).toBe("Base.\n\nExtra.\n\nA2\n\nC1");
    expect(state?.tools.map((t) => t.name)).toEqual(["read", "grep"]);
    expect(state?.declaredToolNames).toEqual(["read", "write", "grep"]);
  });

  it("a system message with replace: true discards the earlier prompt and tools", () => {
    const state = replaySystemMessages([
      systemMessage("s0", { content: "Old.", sections: { a: "A" }, toolsAdded: [tool("read")] }),
      systemMessage("s1", { content: "New.", replace: true, toolsAdded: [tool("bash")] }),
    ]);

    expect(state?.text).toBe("New.");
    expect(state?.tools.map((t) => t.name)).toEqual(["bash"]);
    expect(state?.declaredToolNames).toEqual(["read", "bash"]);
  });

  it("a compaction entry's systemMessage checkpoint becomes the new complete baseline", () => {
    const state = replaySystemMessages([
      systemMessage("s0", { content: "Base.", sections: { a: "A" }, toolsAdded: [tool("read"), tool("write")] }),
      userMessage("u1"),
      {
        type: "compaction",
        id: "c1",
        summary: "...",
        firstKeptEntryId: "u1",
        tokensBefore: 1,
        systemMessage: { role: "system", content: "Checkpoint.", sections: { b: "B" }, toolsAdded: [tool("read")], timestamp: 0 },
      },
    ]);

    expect(state?.text).toBe("Checkpoint.\n\nB");
    expect(state?.tools.map((t) => t.name)).toEqual(["read"]);
  });

  it("ignores a compaction entry without a systemMessage (older sessions)", () => {
    const state = replaySystemMessages([
      systemMessage("s0", { content: "Base." }),
      { type: "compaction", id: "c1", summary: "...", firstKeptEntryId: "c1", tokensBefore: 1 },
    ]);

    expect(state?.text).toBe("Base.");
  });

  it("skips malformed sections/tools rather than throwing", () => {
    const state = replaySystemMessages([
      systemMessage("s0", { content: 42, sections: "nope", toolsAdded: [null, { description: "no name" }, tool("read")] }),
    ]);

    expect(state).toEqual({ baseContent: "", sections: [], text: "", tools: [tool("read")], declaredToolNames: ["read"], toolHistory: [{ name: "read", definition: tool("read"), loadedRequests: 0 }] });
  });
});

const assistant = (id: string): PiRawEntry => ({ type: "message", id, message: { role: "assistant", content: [], usage: { input: 1, output: 1 } } });

// V27 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/savings-increment-3.md §7.1): the tool list can change mid-branch, so
// each tool carries the requests it was declared for, and a removed tool keeps
// the definition it last had.
describe("replaySystemMessages: tool history", () => {
  it("counts the assistant requests each tool was declared for, and keeps a removed tool's last definition", () => {
    const readV2 = { ...tool("read"), description: "read, second version" };
    const state = replaySystemMessages([
      systemMessage("s0", { toolsAdded: [tool("read"), tool("write")] }),
      userMessage("u1"),
      assistant("a1"),
      assistant("a2"),
      systemMessage("s1", { toolsRemoved: [{ name: "write" }], toolsAdded: [readV2, tool("grep")] }),
      assistant("a3"),
    ]);

    expect(state?.toolHistory).toEqual([
      { name: "read", definition: readV2, loadedRequests: 3 },
      { name: "write", definition: tool("write"), loadedRequests: 2 },
      { name: "grep", definition: tool("grep"), loadedRequests: 1 },
    ]);
    expect(state?.tools.map((t) => t.name)).toEqual(["read", "grep"]);
  });

  it("a compaction checkpoint ends the declaration of a tool it leaves out", () => {
    const state = replaySystemMessages([
      systemMessage("s0", { toolsAdded: [tool("read"), tool("write")] }),
      userMessage("u1"),
      assistant("a1"),
      { type: "compaction", id: "c1", summary: "s", firstKeptEntryId: "u1", tokensBefore: 1, systemMessage: { role: "system", content: "", toolsAdded: [tool("read")], timestamp: 0 } },
      assistant("a2"),
    ]);

    expect(state?.toolHistory.map(({ name, loadedRequests }) => [name, loadedRequests])).toEqual([
      ["read", 2],
      ["write", 1],
    ]);
  });

  it("does not count assistant entries before the first user message", () => {
    const state = replaySystemMessages([systemMessage("s0", { toolsAdded: [tool("read")] }), assistant("a0"), userMessage("u1"), assistant("a1")]);

    expect(state?.toolHistory[0]?.loadedRequests).toBe(1);
  });

  it("skips the first N requests when asked (a forked branch's shared prefix, D27)", () => {
    const state = replaySystemMessages([systemMessage("s0", { toolsAdded: [tool("read")] }), userMessage("u1"), assistant("a1"), assistant("a2"), assistant("a3")], 2);

    expect(state?.toolHistory[0]?.loadedRequests).toBe(1);
  });
});
