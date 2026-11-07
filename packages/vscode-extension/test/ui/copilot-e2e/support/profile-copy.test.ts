// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COPIED_ENTRIES, copyProfile } from "./profile-copy.mts";

describe("copyProfile (opt-in real-Copilot suite)", () => {
  let dir: string;
  let source: string;
  let target: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "aica-profile-copy-"));
    source = path.join(dir, "profile");
    target = path.join(dir, "copy");
    mkdirSync(path.join(source, "User", "globalStorage"), { recursive: true });
    writeFileSync(path.join(source, "User", "globalStorage", "state.vscdb"), "state");
    writeFileSync(path.join(source, "User", "settings.json"), "{}");
    writeFileSync(path.join(source, "Local State"), "keys");
    mkdirSync(path.join(source, "logs"));
    writeFileSync(path.join(source, "logs", "old.log"), "log");
    mkdirSync(path.join(source, "Cache"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("copies the profile's User and Local State, and nothing else (no logs, caches or crash dumps)", () => {
    copyProfile(source, target);

    expect(readFileSync(path.join(target, "User", "globalStorage", "state.vscdb"), "utf-8")).toBe("state");
    expect(readFileSync(path.join(target, "Local State"), "utf-8")).toBe("keys");
    expect(existsSync(path.join(target, "logs"))).toBe(false);
    expect(existsSync(path.join(target, "Cache"))).toBe(false);
    expect(COPIED_ENTRIES).toEqual(["User", "Local State"]);
  });

  it("leaves the source untouched, and never writes into it", () => {
    copyProfile(source, target);
    writeFileSync(path.join(target, "User", "settings.json"), '{"changed":true}');

    expect(readFileSync(path.join(source, "User", "settings.json"), "utf-8")).toBe("{}");
  });

  it("refuses a target inside the source (a copy must not be able to write into the real profile)", () => {
    expect(() => copyProfile(source, path.join(source, "copy"))).toThrow(/inside/);
  });
});
