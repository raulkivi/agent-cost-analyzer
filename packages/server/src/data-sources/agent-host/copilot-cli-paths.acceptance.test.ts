import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copilotEventLogPath, resolveCopilotHome } from "./copilot-cli-paths.js";

describe("resolveCopilotHome", () => {
  const home = () => "/home/user";

  it("uses COPILOT_HOME when set", () => {
    expect(resolveCopilotHome({ COPILOT_HOME: "/data/copilot" }, home)).toBe("/data/copilot");
  });

  it("uses COPILOT_HOME as given, untrimmed", () => {
    expect(resolveCopilotHome({ COPILOT_HOME: "  /data/copilot " }, home)).toBe("  /data/copilot ");
  });

  it("falls back to <homedir>/.copilot when unset", () => {
    expect(resolveCopilotHome({}, home)).toBe(path.join("/home/user", ".copilot"));
  });

  it("falls back when COPILOT_HOME is empty or whitespace-only", () => {
    expect(resolveCopilotHome({ COPILOT_HOME: "" }, home)).toBe(path.join("/home/user", ".copilot"));
    expect(resolveCopilotHome({ COPILOT_HOME: "   \t" }, home)).toBe(path.join("/home/user", ".copilot"));
  });

  it("uses the supplied path API", () => {
    expect(resolveCopilotHome({}, () => "C:\\Users\\me", path.win32)).toBe("C:\\Users\\me\\.copilot");
    expect(resolveCopilotHome({}, () => "/home/me", path.posix)).toBe("/home/me/.copilot");
  });

  it("defaults to process.env and os.homedir", () => {
    const saved = process.env.COPILOT_HOME;
    try {
      delete process.env.COPILOT_HOME;
      expect(resolveCopilotHome()).toBe(path.join(os.homedir(), ".copilot"));
      process.env.COPILOT_HOME = "/somewhere/else";
      expect(resolveCopilotHome()).toBe("/somewhere/else");
    } finally {
      if (saved === undefined) delete process.env.COPILOT_HOME;
      else process.env.COPILOT_HOME = saved;
    }
  });
});

describe("copilotEventLogPath", () => {
  const id = "5d1a0001-aaaa-4bbb-8ccc-000000000001";

  it("joins session-state/<id>/events.jsonl", () => {
    expect(copilotEventLogPath("/h/.copilot", id, path.posix)).toBe(`/h/.copilot/session-state/${id}/events.jsonl`);
  });

  it("uses the supplied path API (win32)", () => {
    expect(copilotEventLogPath("C:\\h\\.copilot", id, path.win32)).toBe(`C:\\h\\.copilot\\session-state\\${id}\\events.jsonl`);
  });

  it("defaults to the host path API", () => {
    expect(copilotEventLogPath("/h/.copilot", id)).toBe(path.join("/h/.copilot", "session-state", id, "events.jsonl"));
  });

  it("accepts alphanumeric ids with dashes", () => {
    expect(copilotEventLogPath("/h", "A1-b2", path.posix)).toBe("/h/session-state/A1-b2/events.jsonl");
    expect(copilotEventLogPath("/h", "0", path.posix)).toBe("/h/session-state/0/events.jsonl");
  });

  it.each([
    "",
    "-leading-dash",
    "..",
    "../x",
    "a/b",
    "a\\b",
    "a b",
    "a.b",
    "a_b",
    "a\0b",
    "id\n",
    "é",
  ])("returns null for the unsafe id %j", (bad) => {
    expect(copilotEventLogPath("/h", bad, path.posix)).toBeNull();
  });
});
