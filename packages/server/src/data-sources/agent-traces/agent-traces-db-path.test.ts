import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAgentTracesDbPath } from "./agent-traces-db-path.js";

describe("resolveAgentTracesDbPath", () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(tmpdir(), "agent-traces-db-path-test-"));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("returns null when no VS Code install is present", () => {
    expect(resolveAgentTracesDbPath({ platform: "linux", homeDir: fakeHome })).toBeNull();
  });

  it("returns null when VS Code is installed but agent-traces.db doesn't exist yet (setting off, common case)", () => {
    mkdirSync(path.join(fakeHome, ".config", "Code - Insiders"), { recursive: true });

    expect(resolveAgentTracesDbPath({ platform: "linux", homeDir: fakeHome })).toBeNull();
  });

  it("returns the agent-traces.db path when it exists under globalStorage", () => {
    const globalStorageDir = path.join(
      fakeHome,
      ".config",
      "Code - Insiders",
      "User",
      "globalStorage",
      "github.copilot-chat",
    );
    mkdirSync(globalStorageDir, { recursive: true });
    const dbPath = path.join(globalStorageDir, "agent-traces.db");
    writeFileSync(dbPath, "");

    expect(resolveAgentTracesDbPath({ platform: "linux", homeDir: fakeHome })).toBe(dbPath);
  });
});
