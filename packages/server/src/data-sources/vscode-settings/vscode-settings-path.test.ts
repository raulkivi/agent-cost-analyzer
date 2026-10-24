import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveVscodeSettingsPath, userSettingsFilePath } from "./vscode-settings-path.js";

describe("resolveVscodeSettingsPath", () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(path.join(tmpdir(), "vscode-settings-path-test-"));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("returns null when no VS Code install is present", () => {
    expect(
      resolveVscodeSettingsPath({ platform: "linux", homeDir: fakeHome }),
    ).toBeNull();
  });

  it("returns null when VS Code is installed but settings.json doesn't exist yet", () => {
    mkdirSync(path.join(fakeHome, ".config", "Code - Insiders", "User"), {
      recursive: true,
    });

    expect(
      resolveVscodeSettingsPath({ platform: "linux", homeDir: fakeHome }),
    ).toBeNull();
  });

  it("returns the settings.json path when it exists", () => {
    const userDir = path.join(fakeHome, ".config", "Code - Insiders", "User");
    mkdirSync(userDir, { recursive: true });
    const settingsPath = path.join(userDir, "settings.json");
    writeFileSync(settingsPath, "{}");

    expect(
      resolveVscodeSettingsPath({ platform: "linux", homeDir: fakeHome }),
    ).toBe(settingsPath);
  });
});

describe("userSettingsFilePath", () => {
  it("builds <userData>/User/settings.json without touching the disk", () => {
    expect(userSettingsFilePath(path.join("/x", "Code"))).toBe(path.join("/x", "Code", "User", "settings.json"));
  });
});
