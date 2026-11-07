// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSessionStoreDbPath } from "./session-store-path.js";

describe("resolveSessionStoreDbPath", () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(tmpdir(), "session-store-path-test-"));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("returns null when no VS Code install is present", () => {
    expect(resolveSessionStoreDbPath({ platform: "linux", homeDir: fakeHome })).toBeNull();
  });

  it("returns null when VS Code is installed but the session store db doesn't exist yet", () => {
    mkdirSync(path.join(fakeHome, ".config", "Code - Insiders"), { recursive: true });

    expect(resolveSessionStoreDbPath({ platform: "linux", homeDir: fakeHome })).toBeNull();
  });

  it("returns the session-store.db path when it exists under globalStorage", () => {
    const globalStorageDir = path.join(
      fakeHome,
      ".config",
      "Code - Insiders",
      "User",
      "globalStorage",
      "github.copilot-chat",
    );
    mkdirSync(globalStorageDir, { recursive: true });
    const dbPath = path.join(globalStorageDir, "session-store.db");
    writeFileSync(dbPath, "");

    expect(resolveSessionStoreDbPath({ platform: "linux", homeDir: fakeHome })).toBe(dbPath);
  });
});
