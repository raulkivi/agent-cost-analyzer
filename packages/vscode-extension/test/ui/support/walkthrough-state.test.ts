// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WALKTHROUGH_OFFERED_KEY } from "../../../src/onboarding/walkthrough-offer.js";
import { walkthroughAlreadyOffered } from "./walkthrough-state.js";

describe("walkthroughAlreadyOffered (step 10.16)", () => {
  let userDataDir: string;
  const dbPath = () => path.join(userDataDir, "User", "globalStorage", "state.vscdb");

  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "aica-walkthrough-state-"));
    mkdirSync(path.dirname(dbPath()), { recursive: true });
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  function seed(value: unknown): void {
    const db = new DatabaseSync(dbPath());
    db.exec("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
    db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run("raulkivi.ai-credits-analyzer", JSON.stringify(value));
    db.close();
  }

  it("is false before VS Code has ever run (no state database)", () => {
    expect(walkthroughAlreadyOffered(userDataDir)).toBe(false);
  });

  it("is false when the extension's state doesn't say the walkthrough was offered", () => {
    seed({ other: true });

    expect(walkthroughAlreadyOffered(userDataDir)).toBe(false);
  });

  it("is true once the extension's global state records the offer", () => {
    seed({ [WALKTHROUGH_OFFERED_KEY]: true });

    expect(walkthroughAlreadyOffered(userDataDir)).toBe(true);
  });

  it("is false for a database it can't read", () => {
    const db = new DatabaseSync(dbPath());
    db.exec("CREATE TABLE Unrelated (x TEXT)");
    db.close();

    expect(walkthroughAlreadyOffered(userDataDir)).toBe(false);
  });
});
