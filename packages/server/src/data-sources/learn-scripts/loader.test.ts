// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadScenarioScripts } from "./loader.js";

const valid = (id: string) => ({
  id,
  title: "T",
  category: "C",
  harnesses: ["claude-code"],
  sessionKind: "main",
  staticPrefix: { toolsTokens: 1, systemTokens: 1 },
  steps: [],
});

describe("loadScenarioScripts", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "scripts-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (file: string, body: unknown) =>
    writeFileSync(path.join(dir, file), JSON.stringify(body));

  it("loads every script in the directory, sorted by file name", () => {
    write("b.json", valid("b"));
    write("a.json", valid("a"));
    expect(loadScenarioScripts(dir).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("fails fast on an invalid script, naming the file", () => {
    write("bad.json", { id: "bad" });
    expect(() => loadScenarioScripts(dir)).toThrow(/bad\.json/);
  });

  it("rejects a duplicate id", () => {
    write("a.json", valid("x"));
    write("b.json", valid("x"));
    expect(() => loadScenarioScripts(dir)).toThrow(/duplicate/i);
  });

  it("loads the 18 bundled scripts", () => {
    expect(loadScenarioScripts()).toHaveLength(18);
  });
});
