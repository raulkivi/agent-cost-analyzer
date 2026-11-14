// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listVscodeUserDataRoots, resolveUserDataDir } from "./resolve-user-data-dir.js";

describe("resolveUserDataDir", () => {
  let fakeHome: string;
  let insidersDir: string;
  let stableDir: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(tmpdir(), "vscode-paths-test-"));
    insidersDir = path.join(fakeHome, ".config", "Code - Insiders");
    stableDir = path.join(fakeHome, ".config", "Code");
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  const withUser = (dir: string) => mkdirSync(path.join(dir, "User"), { recursive: true });
  const withoutUser = (dir: string) =>
    mkdirSync(path.join(dir, "Azure Accounts"), { recursive: true });
  const opts = () => ({ platform: "linux" as const, homeDir: fakeHome });

  it("returns null when no VS Code install is present", () => {
    expect(resolveUserDataDir(opts())).toBeNull();
    expect(listVscodeUserDataRoots(opts())).toEqual([]);
  });

  it("returns Insiders with a User folder when Stable has none", () => {
    withUser(insidersDir);
    withoutUser(stableDir);

    expect(resolveUserDataDir(opts())).toBe(insidersDir);
    expect(listVscodeUserDataRoots(opts())).toEqual([insidersDir]);
  });

  it("returns null when Insiders is absent and Stable has no User folder", () => {
    withoutUser(stableDir);

    expect(resolveUserDataDir(opts())).toBeNull();
    expect(listVscodeUserDataRoots(opts())).toEqual([]);
  });

  it("skips Insiders without a User folder and returns Stable with one", () => {
    withoutUser(insidersDir);
    withUser(stableDir);

    expect(resolveUserDataDir(opts())).toBe(stableDir);
  });

  it("returns Stable when only Stable has a User folder", () => {
    withUser(stableDir);

    expect(resolveUserDataDir(opts())).toBe(stableDir);
    expect(listVscodeUserDataRoots(opts())).toEqual([stableDir]);
  });

  it("lists Insiders first, then Stable, when both have a User folder", () => {
    withUser(insidersDir);
    withUser(stableDir);

    expect(listVscodeUserDataRoots(opts())).toEqual([insidersDir, stableDir]);
    expect(resolveUserDataDir(opts())).toBe(insidersDir);
  });

  it("returns null on unsupported platforms", () => {
    withUser(stableDir);

    expect(resolveUserDataDir({ platform: "freebsd", homeDir: fakeHome })).toBeNull();
    expect(listVscodeUserDataRoots({ platform: "freebsd", homeDir: fakeHome })).toEqual([]);
  });

  // Non-native platforms are exercised through an injected `exists` check,
  // since a win32 path can't be created on a POSIX test machine.
  describe("darwin", () => {
    const home = "/Users/alice";
    const appSupport = "/Users/alice/Library/Application Support";
    const existsIn = (...present: string[]) => {
      const set = new Set(present);
      return (p: string) => set.has(p);
    };

    it("returns the Insiders root under Application Support when it has User", () => {
      const insiders = `${appSupport}/Code - Insiders`;
      const exists = existsIn(insiders, `${insiders}/User`);

      expect(resolveUserDataDir({ platform: "darwin", homeDir: home, exists })).toBe(insiders);
    });

    it("returns the Stable root under Application Support when it has User", () => {
      const stable = `${appSupport}/Code`;
      const exists = existsIn(stable, `${stable}/User`);

      expect(resolveUserDataDir({ platform: "darwin", homeDir: home, exists })).toBe(stable);
    });

    it("ignores a root without a User folder", () => {
      const exists = existsIn(`${appSupport}/Code`);

      expect(resolveUserDataDir({ platform: "darwin", homeDir: home, exists })).toBeNull();
    });

    it("prefers Insiders over Stable", () => {
      const exists = existsIn(`${appSupport}/Code - Insiders/User`, `${appSupport}/Code/User`);

      expect(listVscodeUserDataRoots({ platform: "darwin", homeDir: home, exists })).toEqual([
        `${appSupport}/Code - Insiders`,
        `${appSupport}/Code`,
      ]);
    });

    it("does not look under ~/.config", () => {
      const exists = (p: string) => p.includes(".config");

      expect(resolveUserDataDir({ platform: "darwin", homeDir: home, exists })).toBeNull();
    });
  });

  describe("win32", () => {
    const home = "C:\\Users\\alice";

    it("returns the Stable root under %APPDATA% when it has User", () => {
      const env = { APPDATA: "D:\\Roaming" };
      const exists = (p: string) => p === "D:\\Roaming\\Code\\User";

      expect(resolveUserDataDir({ platform: "win32", homeDir: home, env, exists })).toBe(
        "D:\\Roaming\\Code",
      );
    });

    it("prefers Insiders over Stable under %APPDATA%", () => {
      const env = { APPDATA: "D:\\Roaming" };
      const present = new Set(["D:\\Roaming\\Code - Insiders\\User", "D:\\Roaming\\Code\\User"]);
      const exists = (p: string) => present.has(p);

      expect(listVscodeUserDataRoots({ platform: "win32", homeDir: home, env, exists })).toEqual([
        "D:\\Roaming\\Code - Insiders",
        "D:\\Roaming\\Code",
      ]);
      expect(resolveUserDataDir({ platform: "win32", homeDir: home, env, exists })).toBe(
        "D:\\Roaming\\Code - Insiders",
      );
    });

    it("falls back to <home>\\AppData\\Roaming when APPDATA is unset", () => {
      const exists = (p: string) => p === "C:\\Users\\alice\\AppData\\Roaming\\Code\\User";

      expect(resolveUserDataDir({ platform: "win32", homeDir: home, env: {}, exists })).toBe(
        "C:\\Users\\alice\\AppData\\Roaming\\Code",
      );
    });

    it("ignores a root without a User folder", () => {
      const exists = (p: string) => p === "D:\\Roaming\\Code";

      expect(
        resolveUserDataDir({
          platform: "win32",
          homeDir: home,
          env: { APPDATA: "D:\\Roaming" },
          exists,
        }),
      ).toBeNull();
    });

    it("returns null when neither variant exists", () => {
      const exists = () => false;

      expect(resolveUserDataDir({ platform: "win32", homeDir: home, env: {}, exists })).toBeNull();
    });
  });
});
