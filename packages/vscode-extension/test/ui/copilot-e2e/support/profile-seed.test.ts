// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copilotStateSeeds, seedProfileState } from "./profile-seed.mts";

let userDataDir: string;

beforeEach(() => {
  userDataDir = mkdtempSync(path.join(tmpdir(), "aica-seed-test-"));
});

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true });
});

const stateDb = () => path.join(userDataDir, "User", "globalStorage", "state.vscdb");

function readState(): Record<string, string> {
  const db = new DatabaseSync(stateDb(), { readOnly: true });
  try {
    const rows = db.prepare("SELECT key, value FROM ItemTable").all() as { key: string; value: unknown }[];
    return Object.fromEntries(rows.map((row) => [row.key, String(row.value)]));
  } finally {
    db.close();
  }
}

describe("what the real-Copilot suite pre-answers in its profile copy (G3)", () => {
  it("opts in to global auto approve, so agent mode neither asks per tool nor shows the confirmation dialog", () => {
    expect(copilotStateSeeds("claude-haiku-5.5")["chat.tools.global.autoApprove.optIn"]).toBe("true");
  });

  it("selects the requested Copilot model in the chat panel, by its picker identifier", () => {
    expect(copilotStateSeeds("claude-haiku-5.5")["chat.currentLanguageModel.panel"]).toBe("copilot/claude-haiku-5.5");
    expect(copilotStateSeeds("gpt-6-luna")["chat.currentLanguageModel.panel"]).toBe("copilot/gpt-6-luna");
  });
});

describe("seeding the profile copy's global state", () => {
  it("adds the entries and keeps, or replaces, what the profile already holds", () => {
    mkdirSync(path.dirname(stateDb()), { recursive: true });
    const db = new DatabaseSync(stateDb());
    db.exec("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
    db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?), (?, ?)").run("kept", "1", "chat.currentLanguageModel.panel", "copilot/auto");
    db.close();

    seedProfileState(userDataDir, { "chat.currentLanguageModel.panel": "copilot/claude-haiku-5.5", added: "true" });

    expect(readState()).toEqual({ kept: "1", "chat.currentLanguageModel.panel": "copilot/claude-haiku-5.5", added: "true" });
  });

  it("creates the state database when the profile has none yet", () => {
    seedProfileState(userDataDir, { added: "true" });

    expect(readState()).toEqual({ added: "true" });
  });
});
