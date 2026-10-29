import path from "node:path";
import { describe, expect, it } from "vitest";
import { copilotEventLogPath, resolveCopilotHome } from "./copilot-cli-paths.js";

describe("resolveCopilotHome", () => {
  const homedir = () => "/home/me";

  it("falls back to .copilot under the home dir when COPILOT_HOME is unset", () => {
    expect(resolveCopilotHome({}, homedir)).toBe(path.join("/home/me", ".copilot"));
  });

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
  ])("falls back when COPILOT_HOME is %s", (_label, value) => {
    expect(resolveCopilotHome({ COPILOT_HOME: value }, homedir)).toBe(
      path.join("/home/me", ".copilot"),
    );
  });

  // The value is a path: trimming it would change which directory is read.
  it("returns COPILOT_HOME exactly as given, without trimming", () => {
    expect(resolveCopilotHome({ COPILOT_HOME: " /x " }, homedir)).toBe(" /x ");
  });

  it("returns a non-blank COPILOT_HOME unchanged", () => {
    expect(resolveCopilotHome({ COPILOT_HOME: "/data/copilot" }, homedir)).toBe(
      "/data/copilot",
    );
  });

  it("does not call homedir when COPILOT_HOME is set", () => {
    const fail = () => {
      throw new Error("homedir should not be read");
    };
    expect(resolveCopilotHome({ COPILOT_HOME: "/x" }, fail)).toBe("/x");
  });

  it("uses the supplied path API for the fallback join", () => {
    expect(resolveCopilotHome({}, () => "C:\\Users\\me", path.win32)).toBe(
      path.win32.join("C:\\Users\\me", ".copilot"),
    );
  });
});

describe("copilotEventLogPath", () => {
  it("joins session-state/<id>/events.jsonl under the copilot home", () => {
    expect(
      copilotEventLogPath("/home/me/.copilot", "5d1a0001-aaaa-4bbb-8ccc-000000000001"),
    ).toBe(
      path.join(
        "/home/me/.copilot",
        "session-state",
        "5d1a0001-aaaa-4bbb-8ccc-000000000001",
        "events.jsonl",
      ),
    );
  });

  it("uses the supplied path API instead of the process default", () => {
    expect(copilotEventLogPath("C:\\cp", "abc", path.win32)).toBe(
      path.win32.join("C:\\cp", "session-state", "abc", "events.jsonl"),
    );
  });

  it.each(["a", "0abc", "Z9", "a-", "08f55a27-88c9-4cb8-aff9-0da499f24665"])(
    "accepts session id %s",
    (id) => {
      expect(copilotEventLogPath("/cp", id)).toBe(
        path.join("/cp", "session-state", id, "events.jsonl"),
      );
    },
  );

  // Same rule as agentSessionDbPath: anything that could escape session-state/<id>.
  const invalidIds: [string, string][] = [
    ["", "empty string"],
    ["-a", "leading dash"],
    [".a", "leading dot"],
    ["..", "parent dir"],
    ["../evil", "relative traversal"],
    ["/x", "absolute path"],
    ["a/b", "inner slash"],
    ["a\\b", "inner backslash"],
    ["a\n", "trailing newline"],
    ["a b", "space"],
    ["*", "glob character"],
  ];

  it.each(invalidIds)("returns null for %s (%s)", (id) => {
    expect(copilotEventLogPath("/cp", id)).toBeNull();
  });
});
