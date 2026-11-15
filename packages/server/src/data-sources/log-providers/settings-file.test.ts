// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import * as nodeFs from "node:fs";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSettingsFile, writeSettingsFile } from "./settings-file.js";

describe("settings-file (shared settings.json writer)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "settings-file-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads {} for a missing, corrupt or non-object file", () => {
    expect(readSettingsFile(dir)).toEqual({});
    for (const text of ["{not json", "[1,2]", "null", "7"]) {
      writeFileSync(path.join(dir, "settings.json"), text, "utf-8");
      expect(readSettingsFile(dir)).toEqual({});
    }
  });

  it("keeps unknown keys already on disk when writing a patch", () => {
    writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ future: { a: 1 } }), "utf-8");

    writeSettingsFile(dir, { activeProviderId: "pi" });

    expect(readSettingsFile(dir)).toEqual({ future: { a: 1 }, activeProviderId: "pi" });
  });

  it.skipIf(process.platform === "win32")("writes the file with mode 0600", () => {
    writeSettingsFile(dir, { activeProviderId: "pi" });

    expect(statSync(path.join(dir, "settings.json")).mode & 0o777).toBe(0o600);
  });

  it("leaves the old file intact and no temp file when the rename fails", () => {
    writeSettingsFile(dir, { activeProviderId: "old" });
    const failingFs = {
      ...nodeFs,
      renameSync: () => {
        throw new Error("disk gone");
      },
    };

    expect(() => writeSettingsFile(dir, { activeProviderId: "new" }, failingFs)).toThrow("disk gone");

    expect(JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf-8"))).toEqual({ activeProviderId: "old" });
    expect(readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("never touches settings.json while the temp file is being written", () => {
    writeSettingsFile(dir, { activeProviderId: "old" });
    const failingFs = {
      ...nodeFs,
      writeFileSync: (target: string) => {
        nodeFs.writeFileSync(target, '{"activeProv', "utf-8"); // torn temp
        throw new Error("crash mid-write");
      },
    };

    expect(() => writeSettingsFile(dir, { activeProviderId: "new" }, failingFs as never)).toThrow("crash mid-write");

    expect(readSettingsFile(dir)).toEqual({ activeProviderId: "old" });
    expect(readdirSync(dir)).toEqual(["settings.json"]);
  });
});
