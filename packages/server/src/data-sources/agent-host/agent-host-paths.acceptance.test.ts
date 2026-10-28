import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentHostDbPath, agentSessionDbPath } from "./agent-host-paths.js";

describe("agentHostDbPath", () => {
  it("joins User/globalStorage/agent-host.db (posix)", () => {
    expect(agentHostDbPath("/home/user/.config/Code - Insiders")).toBe(
      path.join("/home/user/.config/Code - Insiders", "User", "globalStorage", "agent-host.db"),
    );
  });

  it("uses the supplied path API (win32)", () => {
    expect(agentHostDbPath("C:\\Users\\me\\AppData\\Roaming\\Code", path.win32)).toBe(
      "C:\\Users\\me\\AppData\\Roaming\\Code\\User\\globalStorage\\agent-host.db",
    );
  });

  it("uses the supplied path API (posix)", () => {
    expect(agentHostDbPath("/data", path.posix)).toBe("/data/User/globalStorage/agent-host.db");
  });
});

describe("agentSessionDbPath", () => {
  const id = "08f55a27-88c9-4cb8-aff9-0da499f24665";

  it("joins agentSessionData/<id>/session.db", () => {
    expect(agentSessionDbPath("/data", id, path.posix)).toBe(`/data/agentSessionData/${id}/session.db`);
  });

  it("defaults to the host path API", () => {
    expect(agentSessionDbPath("/data", id)).toBe(path.join("/data", "agentSessionData", id, "session.db"));
  });

  it("supports win32 paths", () => {
    expect(agentSessionDbPath("C:\\Users\\me\\Code", id, path.win32)).toBe(
      `C:\\Users\\me\\Code\\agentSessionData\\${id}\\session.db`,
    );
  });

  it("accepts ids made of alphanumerics and dashes, starting alphanumeric", () => {
    expect(agentSessionDbPath("/data", "a", path.posix)).toBe("/data/agentSessionData/a/session.db");
    expect(agentSessionDbPath("/data", "0-A-z-9", path.posix)).toBe("/data/agentSessionData/0-A-z-9/session.db");
  });

  it.each([
    ["empty", ""],
    ["parent dir", ".."],
    ["current dir", "."],
    ["traversal", "../etc"],
    ["embedded traversal", "a/../b"],
    ["forward slash", "a/b"],
    ["leading slash", "/abs"],
    ["backslash", "a\\b"],
    ["win32 traversal", "..\\x"],
    ["leading dash", "-abc"],
    ["underscore", "a_b"],
    ["dot in id", "a.b"],
    ["space", "a b"],
    ["newline suffix", "abc\n"],
    ["null byte", "ab\0c"],
    ["unicode", "ab\u00e9"],
  ])("returns null for %s", (_label, bad) => {
    expect(agentSessionDbPath("/data", bad, path.posix)).toBeNull();
    expect(agentSessionDbPath("C:\\d", bad, path.win32)).toBeNull();
  });
});
