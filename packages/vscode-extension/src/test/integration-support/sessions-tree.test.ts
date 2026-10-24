import { describe, expect, it } from "vitest";
import type { SessionNode, SessionsTreeNode } from "../../sidebar/sessions-tree-model.js";
import { sessionNodesOf } from "./sessions-tree.js";

function sessionNode(sessionId: string): SessionNode {
  return { kind: "session", sessionId, label: sessionId, description: "", tooltip: "", ariaLabel: "" };
}

describe("sessionNodesOf", () => {
  it("lists every session row under every day group, in tree order", () => {
    const tree: SessionsTreeNode[] = [
      { kind: "group", id: "2026-10-24", label: "Today", description: "", expanded: true, children: [sessionNode("a"), sessionNode("b")] },
      { kind: "group", id: "undated", label: "Undated", description: "", expanded: false, children: [sessionNode("c")] },
    ];

    expect(sessionNodesOf(tree).map((node) => node.sessionId)).toEqual(["a", "b", "c"]);
  });

  it("has none for a tree that's empty or only a message", () => {
    expect(sessionNodesOf([])).toEqual([]);
    expect(sessionNodesOf([{ kind: "message", label: "Couldn't read", description: "", icon: "error" }])).toEqual([]);
  });
});
