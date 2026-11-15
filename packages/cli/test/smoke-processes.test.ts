// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// How the npm-package smoke starts and stops what it runs, per OS
// (npm-package.md §4.8 steps 3-7), and the environment it gives them.
import { describe, expect, it } from "vitest";
import { DEAD_REGISTRY, installedBin, invocation, isolatedEnv, stopAction } from "../smoke/processes.mts";

describe("invocation", () => {
  it("runs the program itself on macOS and Linux, with no shell", () => {
    for (const platform of ["linux", "darwin"] as const) {
      expect(invocation(platform, "npx", ["--yes", "--package=/tmp/a b/x.tgz", "agent-cost-analyzer", "--version"])).toEqual({
        command: "npx",
        args: ["--yes", "--package=/tmp/a b/x.tgz", "agent-cost-analyzer", "--version"],
      });
    }
  });

  it("goes through cmd.exe on Windows, where npm, npx and the bin are .cmd files, quoting what needs it", () => {
    expect(invocation("win32", "npx", ["--yes", "--package=C:\\Temp\\a b\\x.tgz", "agent-cost-analyzer", "--version"])).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", '"npx --yes "--package=C:\\Temp\\a b\\x.tgz" agent-cost-analyzer --version"'],
      windowsVerbatimArguments: true,
    });
    expect(invocation("win32", "C:\\p\\node_modules\\.bin\\agent-cost-analyzer.cmd", ["--no-open", "--port", "0"]).args[3]).toBe(
      '"C:\\p\\node_modules\\.bin\\agent-cost-analyzer.cmd --no-open --port 0"',
    );
  });

  it("refuses on Windows an argument cmd.exe would expand or split", () => {
    for (const arg of ['a"b', "%PATH%", "a!b", "line\nbreak"]) {
      expect(() => invocation("win32", "npm", [arg]), arg).toThrow(/cannot pass/);
    }
  });
});

describe("installedBin", () => {
  it("is the bin npm links into the project's node_modules/.bin", () => {
    expect(installedBin("linux", "/tmp/p")).toBe("/tmp/p/node_modules/.bin/agent-cost-analyzer");
    expect(installedBin("darwin", "/tmp/p")).toBe("/tmp/p/node_modules/.bin/agent-cost-analyzer");
    expect(installedBin("win32", "C:\\t\\p")).toBe("C:\\t\\p\\node_modules\\.bin\\agent-cost-analyzer.cmd");
  });
});

describe("stopAction", () => {
  it("sends SIGINT, as Ctrl+C does, on macOS and Linux", () => {
    expect(stopAction("linux", 42)).toEqual({ kind: "signal", signal: "SIGINT" });
    expect(stopAction("darwin", 42)).toEqual({ kind: "signal", signal: "SIGINT" });
  });

  it("kills the process tree on Windows, where the bin runs under cmd.exe and has no SIGINT", () => {
    expect(stopAction("win32", 42)).toEqual({ kind: "command", invocation: { command: "taskkill", args: ["/pid", "42", "/T", "/F"] } });
  });
});

describe("isolatedEnv", () => {
  const base = {
    PATH: "/usr/bin",
    Path: "C:\\Windows",
    HOME: "/home/me",
    AppData: "C:\\Users\\me\\AppData\\Roaming",
    XDG_CONFIG_HOME: "/home/me/.config",
    XDG_DATA_HOME: "/home/me/.local/share",
    COPILOT_HOME: "/home/me/.copilot",
    CLAUDE_CONFIG_DIR: "/home/me/.claude",
    PI_CODING_AGENT_DIR: "/home/me/.pi",
    AGENT_COST_ANALYZER_NOW: "2026-11-06T12:00:00Z",
    NODE_OPTIONS: "--import tsx",
    npm_config_cache: "/home/me/.npm",
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    npm_lifecycle_event: "smoke:npm-package",
    npm_package_json: "/repo/package.json",
    CI: "true",
    UNSET: undefined,
  };

  it("keeps the rest of the environment and points the home, the settings folders and npm at the smoke's own folders", () => {
    expect(isolatedEnv(base, { home: "/tmp/h", npmCache: "/tmp/c", platform: "linux" })).toEqual({
      PATH: "/usr/bin",
      Path: "C:\\Windows",
      CI: "true",
      HOME: "/tmp/h",
      USERPROFILE: "/tmp/h",
      XDG_CONFIG_HOME: "/tmp/h/.config",
      APPDATA: "/tmp/h/AppData/Roaming",
      LOCALAPPDATA: "/tmp/h/AppData/Local",
      npm_config_cache: "/tmp/c",
      npm_config_registry: DEAD_REGISTRY,
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false",
    });
  });

  it("uses a registry nothing listens on, so any registry fetch fails", () => {
    expect(DEAD_REGISTRY).toBe("http://127.0.0.1:9/");
  });
});
