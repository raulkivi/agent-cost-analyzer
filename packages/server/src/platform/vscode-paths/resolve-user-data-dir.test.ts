import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveUserDataDir } from "./resolve-user-data-dir.js";

describe("resolveUserDataDir", () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(tmpdir(), "vscode-paths-test-"));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("returns null when no VS Code install is present", () => {
    expect(resolveUserDataDir({ platform: "linux", homeDir: fakeHome })).toBeNull();
  });

  it("returns the Insiders user-data dir when only Insiders is installed", () => {
    const insidersDir = path.join(fakeHome, ".config", "Code - Insiders");
    mkdirSync(insidersDir, { recursive: true });

    expect(resolveUserDataDir({ platform: "linux", homeDir: fakeHome })).toBe(insidersDir);
  });

  it("returns the Stable user-data dir when only Stable is installed", () => {
    const stableDir = path.join(fakeHome, ".config", "Code");
    mkdirSync(stableDir, { recursive: true });

    expect(resolveUserDataDir({ platform: "linux", homeDir: fakeHome })).toBe(stableDir);
  });

  it("prefers Insiders over Stable when both are installed", () => {
    const insidersDir = path.join(fakeHome, ".config", "Code - Insiders");
    const stableDir = path.join(fakeHome, ".config", "Code");
    mkdirSync(insidersDir, { recursive: true });
    mkdirSync(stableDir, { recursive: true });

    expect(resolveUserDataDir({ platform: "linux", homeDir: fakeHome })).toBe(insidersDir);
  });

  it("returns null on unsupported platforms", () => {
    mkdirSync(path.join(fakeHome, ".config", "Code"), { recursive: true });

    expect(resolveUserDataDir({ platform: "freebsd", homeDir: fakeHome })).toBeNull();
  });

  // Non-native platforms are exercised through an injected `exists` check,
  // since a win32 path can't be created on a POSIX test machine.
  describe("darwin", () => {
    const home = "/Users/alice";
    const appSupport = "/Users/alice/Library/Application Support";

    it("returns the Insiders user-data dir under Application Support", () => {
      const insiders = `${appSupport}/Code - Insiders`;
      const exists = (p: string) => p === insiders;

      expect(resolveUserDataDir({ platform: "darwin", homeDir: home, exists })).toBe(insiders);
    });

    it("returns the Stable user-data dir under Application Support", () => {
      const stable = `${appSupport}/Code`;
      const exists = (p: string) => p === stable;

      expect(resolveUserDataDir({ platform: "darwin", homeDir: home, exists })).toBe(stable);
    });

    it("prefers Insiders over Stable", () => {
      const present = new Set([`${appSupport}/Code - Insiders`, `${appSupport}/Code`]);
      const exists = (p: string) => present.has(p);

      expect(resolveUserDataDir({ platform: "darwin", homeDir: home, exists })).toBe(
        `${appSupport}/Code - Insiders`,
      );
    });

    it("does not look under ~/.config", () => {
      const exists = (p: string) => p.includes(".config");

      expect(resolveUserDataDir({ platform: "darwin", homeDir: home, exists })).toBeNull();
    });
  });

  describe("win32", () => {
    const home = "C:\\Users\\alice";

    it("returns the Stable user-data dir under %APPDATA%", () => {
      const env = { APPDATA: "D:\\Roaming" };
      const exists = (p: string) => p === "D:\\Roaming\\Code";

      expect(resolveUserDataDir({ platform: "win32", homeDir: home, env, exists })).toBe(
        "D:\\Roaming\\Code",
      );
    });

    it("prefers Insiders over Stable under %APPDATA%", () => {
      const env = { APPDATA: "D:\\Roaming" };
      const present = new Set(["D:\\Roaming\\Code - Insiders", "D:\\Roaming\\Code"]);
      const exists = (p: string) => present.has(p);

      expect(resolveUserDataDir({ platform: "win32", homeDir: home, env, exists })).toBe(
        "D:\\Roaming\\Code - Insiders",
      );
    });

    it("falls back to <home>\\AppData\\Roaming when APPDATA is unset", () => {
      const exists = (p: string) => p === "C:\\Users\\alice\\AppData\\Roaming\\Code";

      expect(resolveUserDataDir({ platform: "win32", homeDir: home, env: {}, exists })).toBe(
        "C:\\Users\\alice\\AppData\\Roaming\\Code",
      );
    });

    it("returns null when neither variant exists", () => {
      const exists = () => false;

      expect(
        resolveUserDataDir({ platform: "win32", homeDir: home, env: {}, exists }),
      ).toBeNull();
    });
  });
});
