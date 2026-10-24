import { describe, expect, it } from "vitest";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import { findLeafEntryIds, walkBranch } from "./session-tree.js";

function entry(id: string, parentId: string | undefined, type = "message"): PiRawEntry {
  return { type, id, parentId };
}

describe("findLeafEntryIds", () => {
  it("returns the single tail entry for a linear chain", () => {
    const entries = [entry("e1", "root"), entry("e2", "e1"), entry("e3", "e2")];

    expect(findLeafEntryIds(entries)).toEqual(["e3"]);
  });

  it("returns every branch tip when the tree forks", () => {
    const entries = [
      entry("e1", "root"),
      entry("e2", "e1"),
      entry("e3", "e1"), // forked sibling of e2
      entry("e4", "e2"),
    ];

    expect(findLeafEntryIds(entries).sort()).toEqual(["e3", "e4"]);
  });

  it("returns an empty array for an empty entry list", () => {
    expect(findLeafEntryIds([])).toEqual([]);
  });
});

describe("walkBranch", () => {
  it("walks parentId back to the root, returning root-to-leaf order", () => {
    const entries = [entry("e1", "root"), entry("e2", "e1"), entry("e3", "e2")];

    expect(walkBranch(entries, "e3").map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("stops at a parentId not present among the given entries (the session header)", () => {
    const entries = [entry("e1", "session-header-id"), entry("e2", "e1")];

    expect(walkBranch(entries, "e2").map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("returns only the branch leading to the requested leaf, excluding sibling forks", () => {
    const entries = [
      entry("e1", "root"),
      entry("e2", "e1"),
      entry("e3", "e1"),
      entry("e4", "e2"),
    ];

    expect(walkBranch(entries, "e3").map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(walkBranch(entries, "e4").map((e) => e.id)).toEqual(["e1", "e2", "e4"]);
  });

  it("returns an empty array for an unknown leaf id", () => {
    const entries = [entry("e1", "root")];

    expect(walkBranch(entries, "does-not-exist")).toEqual([]);
  });
});
