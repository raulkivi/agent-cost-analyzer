import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentHostDbPath, agentSessionDbPath } from "./agent-host-paths.js";

describe("agentHostDbPath", () => {
  it("joins agent-host.db under User/globalStorage of the user-data dir", () => {
    expect(agentHostDbPath(path.join("/x", "Code"))).toBe(
      path.join("/x", "Code", "User", "globalStorage", "agent-host.db"),
    );
  });

  it("uses the supplied path API instead of the process default", () => {
    expect(agentHostDbPath("C:\\Users\\me", path.win32)).toBe(
      path.win32.join("C:\\Users\\me", "User", "globalStorage", "agent-host.db"),
    );
  });
});

describe("agentSessionDbPath", () => {
  const validIds = [
    "a",
    "0abc",
    "Z9",
    "a-",
    "08f55a27-88c9-4cb8-aff9-0da499f24665",
  ];

  it.each(validIds)("accepts session id %s", (id) => {
    expect(agentSessionDbPath("/userData", id)).toBe(
      path.join("/userData", "agentSessionData", id, "session.db"),
    );
  });

  it("uses the supplied path API instead of the process default", () => {
    expect(agentSessionDbPath("C:\\Users\\me", "abc", path.win32)).toBe(
      path.win32.join("C:\\Users\\me", "agentSessionData", "abc", "session.db"),
    );
  });

  // Every shape that could escape the agentSessionData/<id> directory.
  const invalidIds: [string, string][] = [
    ["", "empty string"],
    ["-", "lone dash"],
    ["..", "parent dir"],
    ["../evil", "relative traversal"],
    ["/x", "absolute path"],
    ["\\", "lone backslash"],
    ["a/b", "inner slash"],
    ["a\\b", "inner backslash"],
    ["a b", "space"],
    ["ses.sion", "dot"],
    ["*", "glob character"],
    ["\n", "newline"],
  ];

  it.each(invalidIds)("returns null for %s", (id) => {
    expect(agentSessionDbPath("/userData", id)).toBeNull();
  });
});
