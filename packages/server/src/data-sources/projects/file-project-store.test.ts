// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileProjectStore, MAX_PROJECTS_FILE_BYTES, PROJECTS_FILE_NAME } from "./file-project-store.js";

describe("FileProjectStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "project-store-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lives at projects.json in the app's settings folder", () => {
    expect(new FileProjectStore(dir).location).toBe(path.join(dir, PROJECTS_FILE_NAME));
    expect(PROJECTS_FILE_NAME).toBe("projects.json");
  });

  it("reads a missing file as missing", () => {
    expect(new FileProjectStore(dir).read()).toEqual({ status: "missing" });
  });

  it("writes, then reads back the same text, leaving no temporary file behind", () => {
    const store = new FileProjectStore(dir);

    store.write('{"version":1}\n');

    expect(store.read()).toEqual({ status: "read", text: '{"version":1}\n' });
    expect(readdirSync(dir)).toEqual([PROJECTS_FILE_NAME]);
  });

  it("creates the settings folder if it doesn't exist yet", () => {
    const store = new FileProjectStore(path.join(dir, "not", "yet"));

    store.write("{}");

    expect(readFileSync(path.join(dir, "not", "yet", PROJECTS_FILE_NAME), "utf-8")).toBe("{}");
  });

  it("refuses to read a file over the size limit", () => {
    writeFileSync(path.join(dir, PROJECTS_FILE_NAME), "x".repeat(MAX_PROJECTS_FILE_BYTES + 1));

    const result = new FileProjectStore(dir).read();

    expect(result.status).toBe("unreadable");
  });

  it("reports a folder in the file's place as unreadable, not missing", () => {
    mkdirSync(path.join(dir, PROJECTS_FILE_NAME));

    expect(new FileProjectStore(dir).read().status).toBe("unreadable");
  });
});
