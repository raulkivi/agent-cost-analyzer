// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  claudeDesktopConfigPath,
  codexHome,
  geminiSettingsPath,
  pathFlavor,
  vscodeUserDir,
} from "../../src/mcp-setup/client-paths.js";
import { fakeEnv } from "./fake-client-env.js";

describe("claudeDesktopConfigPath", () => {
  it("uses Application Support on macOS", () => {
    const env = fakeEnv({ platform: "darwin", home: "/Users/u" });
    expect(claudeDesktopConfigPath(env)).toBe(
      "/Users/u/Library/Application Support/Claude/claude_desktop_config.json",
    );
  });

  it("uses APPDATA on Windows with backslashes", () => {
    const env = fakeEnv({
      platform: "win32",
      home: "C:\\Users\\u",
      env: { APPDATA: "D:\\Roam" },
    });
    expect(claudeDesktopConfigPath(env)).toBe(
      "D:\\Roam\\Claude\\claude_desktop_config.json",
    );
  });

  it("falls back to AppData\\Roaming under home when APPDATA is unset", () => {
    const env = fakeEnv({ platform: "win32", home: "C:\\Users\\u" });
    expect(claudeDesktopConfigPath(env)).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json",
    );
  });

  it("honors XDG_CONFIG_HOME on Linux", () => {
    const env = fakeEnv({ env: { XDG_CONFIG_HOME: "/x/cfg" } });
    expect(claudeDesktopConfigPath(env)).toBe(
      "/x/cfg/Claude/claude_desktop_config.json",
    );
  });

  it("defaults to ~/.config on Linux", () => {
    expect(claudeDesktopConfigPath(fakeEnv())).toBe(
      "/home/u/.config/Claude/claude_desktop_config.json",
    );
  });

  it("ignores an empty XDG_CONFIG_HOME", () => {
    expect(
      claudeDesktopConfigPath(fakeEnv({ env: { XDG_CONFIG_HOME: "" } })),
    ).toBe("/home/u/.config/Claude/claude_desktop_config.json");
  });
});

describe("pathFlavor", () => {
  it("picks the separator by platform, not by the host OS", () => {
    expect(pathFlavor("win32").sep).toBe("\\");
    expect(pathFlavor("linux").sep).toBe("/");
    expect(pathFlavor("darwin").sep).toBe("/");
  });
});

describe("vscodeUserDir", () => {
  it("uses ~/.config/Code/User on Linux, honoring XDG_CONFIG_HOME", () => {
    expect(vscodeUserDir(fakeEnv())).toBe("/home/u/.config/Code/User");
    expect(vscodeUserDir(fakeEnv({ env: { XDG_CONFIG_HOME: "/x" } }))).toBe(
      "/x/Code/User",
    );
  });

  it("uses Application Support on macOS", () => {
    const env = fakeEnv({ platform: "darwin", home: "/Users/u" });
    expect(vscodeUserDir(env)).toBe(
      "/Users/u/Library/Application Support/Code/User",
    );
  });

  it("uses APPDATA on Windows, falling back under home", () => {
    const base = { platform: "win32", home: "C:\\Users\\u" } as const;
    expect(vscodeUserDir(fakeEnv({ ...base, env: { APPDATA: "D:\\R" } }))).toBe(
      "D:\\R\\Code\\User",
    );
    expect(vscodeUserDir(fakeEnv(base))).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\Code\\User",
    );
  });
});

describe("codexHome", () => {
  it("honors CODEX_HOME and defaults to ~/.codex", () => {
    expect(codexHome(fakeEnv())).toBe("/home/u/.codex");
    expect(codexHome(fakeEnv({ env: { CODEX_HOME: "/c/h" } }))).toBe("/c/h");
  });
});

describe("geminiSettingsPath", () => {
  it("is under home for user scope and under cwd for project scope", () => {
    const env = fakeEnv();
    expect(geminiSettingsPath("user", env)).toBe(
      "/home/u/.gemini/settings.json",
    );
    expect(geminiSettingsPath("project", env)).toBe(
      "/work/proj/.gemini/settings.json",
    );
  });
});
