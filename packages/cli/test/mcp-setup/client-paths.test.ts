// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  claudeDesktopConfigPath,
  pathFlavor,
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
