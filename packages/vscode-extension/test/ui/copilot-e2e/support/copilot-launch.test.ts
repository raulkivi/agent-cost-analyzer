// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_HOOKS_ENV } from "../../../../src/diagnostics/test-hooks.ts";
import { renderVscodeArgs } from "../../../../scripts/ui-automation/copilot-vscode-args.mts";
import { KEEP_EXTENSIONS_MARKER } from "../../../../scripts/ui-automation/keep-extensions-service.mts";
import { PINNED_VSCODE_VERSION } from "../../../../scripts/ui-automation/vscode-version.mts";
import { CHAT_HISTORY_ENV } from "./chat-history-seed.mts";
import { COPILOT_E2E_SETTINGS } from "./copilot-e2e-settings.mts";
import {
  COPILOT_E2E_SPECS,
  copilotCapability,
  copilotLaunchPaths,
  copilotLaunchVscodeArgs,
  copilotUserSettings,
  launcherEnv,
  PACKAGE_DIR,
  prepareCopilotLaunch,
  type CopilotLaunchDeps,
} from "./copilot-launch.mts";
import { MAX_AI_CREDITS_INTERNAL_ENV } from "./credit-budget.mts";
import { COPILOT_E2E_ROOT_ENV } from "./run-log.mts";

const DEMO_SETTINGS = { "workbench.colorTheme": "Default Dark Modern", "editor.fontFamily": "DejaVu Sans Mono", "window.title": "${rootName}" };

describe("copilotLaunchPaths", () => {
  it("keeps everything a run writes under its root", () => {
    expect(copilotLaunchPaths("/run")).toEqual({
      rootDir: "/run",
      storagePath: "/run/storage",
      settingsDir: "/run/storage/settings",
      extensionsDir: "/run/storage/extensions",
      workspacePath: "/run/workspace",
      reposDir: "/run/repos",
      copilotHome: "/run/copilot-home",
      binDir: "/run/bin",
    });
  });
});

describe("copilotUserSettings", () => {
  it("is the suite's settings when nothing overrides them", () => {
    expect(copilotUserSettings()).toEqual(COPILOT_E2E_SETTINGS);
  });

  it("merges the caller's settings on top, without changing the suite's", () => {
    const before = structuredClone(COPILOT_E2E_SETTINGS);
    const settings = copilotUserSettings({ ...DEMO_SETTINGS, "update.mode": "manual" });
    expect(settings).toMatchObject(DEMO_SETTINGS);
    expect(settings["update.mode"]).toBe("manual");
    expect(settings["chat.newSession.defaultMode"]).toBe(COPILOT_E2E_SETTINGS["chat.newSession.defaultMode"]);
    expect(COPILOT_E2E_SETTINGS).toEqual(before);
  });
});

describe("copilotLaunchVscodeArgs", () => {
  it("keeps the window in X11, the basic password store and normal mode with the run's shared storage", () => {
    const args = copilotLaunchVscodeArgs("/run/storage");
    expect(args).toMatchObject({ "ozone-platform": "x11", "password-store": "basic", extensionTestsPath: "", "shared-data-dir": "/run/storage/shared-data" });
    expect(renderVscodeArgs(args)).toContain("--ozone-platform=x11");
  });
});

describe("copilotCapability", () => {
  it("launches the pinned VS Code, keeping extensions, on the run's storage and workspace", () => {
    const capability = copilotCapability({ extensionPath: "/pkg", storagePath: "/run/storage", workspacePath: "/run/workspace", userSettings: { a: 1 } });
    expect(capability).toEqual({
      browserName: "vscode",
      browserVersion: PINNED_VSCODE_VERSION,
      [KEEP_EXTENSIONS_MARKER]: true,
      "wdio:vscodeOptions": {
        extensionPath: "/pkg",
        storagePath: "/run/storage",
        workspacePath: "/run/workspace",
        userSettings: { a: 1 },
        verboseLogging: false,
        vscodeArgs: copilotLaunchVscodeArgs("/run/storage"),
      },
    });
  });
});

describe("launcherEnv", () => {
  it("hands the root to the workers under the caller's variable, with the model and the cap", () => {
    expect(launcherEnv({ rootEnv: "AICA_DEMO_ROOT", rootDir: "/run", model: "claude-haiku-5.5", maxAiCredits: 0, copilotHome: "/run/copilot-home" })).toEqual({
      AICA_DEMO_ROOT: "/run",
      AI_CREDITS_ANALYZER_COPILOT_E2E_MODEL: "claude-haiku-5.5",
      [MAX_AI_CREDITS_INTERNAL_ENV]: "0",
      COPILOT_HOME: "/run/copilot-home",
    });
  });
});

class Exited extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

describe("prepareCopilotLaunch", () => {
  let dir: string;
  let profile: string;
  let lines: string[];
  let cleanups: (() => void)[];

  function deps(env: Record<string, string | undefined>): CopilotLaunchDeps {
    return {
      env,
      log: (line) => lines.push(line),
      exit: (code) => {
        throw new Exited(code);
      },
      onExit: (cleanup) => cleanups.push(cleanup),
      now: () => new Date("2026-11-13T12:00:00Z"),
    };
  }

  function optedIn(extra: Record<string, string> = {}): Record<string, string | undefined> {
    return { COPILOT_E2E: "1", COPILOT_E2E_USER_DATA_DIR: profile, COPILOT_E2E_MAX_AI_CREDITS: "0", ...extra };
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "copilot-launch-test-"));
    profile = path.join(dir, "profile");
    mkdirSync(path.join(profile, "User"), { recursive: true });
    writeFileSync(path.join(profile, "User", "settings.json"), "{}");
    writeFileSync(path.join(profile, "Local State"), "{}");
    lines = [];
    cleanups = [];
  });

  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips with exit 0 and says why in the launcher when the run isn't opted in", () => {
    expect(() => prepareCopilotLaunch({}, deps({}))).toThrow(new Exited(0));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[copilot-e2e\] SKIPPED: .*COPILOT_E2E=1/);
  });

  it("skips quietly in a worker, which the root variable marks", () => {
    expect(() => prepareCopilotLaunch({ rootEnv: "AICA_DEMO_ROOT" }, deps({ AICA_DEMO_ROOT: dir }))).toThrow(new Exited(0));
    expect(lines).toEqual([]);
  });

  it("in a worker, reads the root from the caller's variable and touches nothing", () => {
    const root = path.join(dir, "run");
    const env = optedIn({ AICA_DEMO_ROOT: root, [COPILOT_E2E_ROOT_ENV]: path.join(dir, "release-run") });
    const launch = prepareCopilotLaunch({ rootEnv: "AICA_DEMO_ROOT", specs: ["./test/ui/demo-copilot/**/*.demo.ts"], userSettings: DEMO_SETTINGS }, deps(env));

    expect(launch.inWorker).toBe(true);
    expect(launch.paths).toEqual(copilotLaunchPaths(root));
    expect(existsSync(root)).toBe(false);
    expect(launch.run).toEqual({ userDataDir: profile, model: "claude-haiku-5.5", maxAiCredits: 0 });
    expect(launch.config.specs).toEqual(["./test/ui/demo-copilot/**/*.demo.ts"]);
    expect(launch.config.maxInstances).toBe(1);
    expect(launch.config.capabilities).toEqual([
      copilotCapability({ extensionPath: PACKAGE_DIR, storagePath: launch.paths.storagePath, workspacePath: launch.paths.workspacePath, userSettings: copilotUserSettings(DEMO_SETTINGS) }),
    ]);
    expect(launch.config.services).toEqual([["vscode", { cachePath: path.join(PACKAGE_DIR, ".wdio-vscode-service") }]]);
    expect(env[TEST_HOOKS_ENV]).toBe("1");
    expect(lines).toEqual([]);
  });

  it("defaults to the release suite's specs, settings and root variable", () => {
    const root = path.join(dir, "run");
    const launch = prepareCopilotLaunch({}, deps(optedIn({ [COPILOT_E2E_ROOT_ENV]: root })));
    expect(launch.inWorker).toBe(true);
    expect(launch.paths.rootDir).toBe(root);
    expect(launch.config.specs).toEqual(COPILOT_E2E_SPECS);
    expect(COPILOT_E2E_SPECS).toEqual(["./test/ui/copilot-e2e/specs/**/*.e2e.ts"]);
    const [capability] = launch.config.capabilities as WebdriverIO.Capabilities[];
    expect(capability["wdio:vscodeOptions"]?.userSettings).toEqual(COPILOT_E2E_SETTINGS);
  });

  it("in the launcher, prepares a fresh root, seeds the copy and hands the run to the workers", () => {
    const env = optedIn();
    const launch = prepareCopilotLaunch({ rootEnv: "AICA_DEMO_ROOT", tmpPrefix: "copilot-launch-run-" }, deps(env));

    expect(launch.inWorker).toBe(false);
    const { rootDir, settingsDir, extensionsDir, workspacePath, copilotHome, reposDir } = launch.paths;
    expect(path.basename(rootDir)).toMatch(/^copilot-launch-run-/);
    expect(env).toMatchObject({ ...launcherEnv({ rootEnv: "AICA_DEMO_ROOT", rootDir, model: "claude-haiku-5.5", maxAiCredits: 0, copilotHome }), [TEST_HOOKS_ENV]: "1" });
    expect(env[COPILOT_E2E_ROOT_ENV]).toBeUndefined();
    expect(existsSync(path.join(settingsDir, "User", "settings.json"))).toBe(true);
    expect(existsSync(path.join(settingsDir, "User", "globalStorage", "state.vscdb"))).toBe(true);
    expect(existsSync(path.join(settingsDir, "User", "prompts", "aica-e2e.agent.md"))).toBe(true);
    expect(existsSync(path.join(workspacePath, ".git"))).toBe(true);
    expect(existsSync(copilotHome)).toBe(true);
    expect(readdirSync(extensionsDir)).toContain("extensions.json");
    expect(JSON.parse(env[CHAT_HISTORY_ENV] ?? "null")).not.toBeNull();
    expect(existsSync(reposDir)).toBe(true);
    expect(lines.some((line) => line.startsWith("[copilot-e2e] running on a copy of"))).toBe(true);

    // The copy is deleted when the launcher exits.
    expect(cleanups).toHaveLength(1);
    cleanups[0]!();
    expect(existsSync(rootDir)).toBe(false);
  });

  it("leaves the made-up chat history out when asked", () => {
    const env = optedIn();
    const launch = prepareCopilotLaunch({ seedChatHistory: false }, deps(env));
    expect(env[COPILOT_E2E_ROOT_ENV]).toBe(launch.paths.rootDir);
    expect(env[CHAT_HISTORY_ENV]).toBeUndefined();
    expect(existsSync(launch.paths.reposDir)).toBe(false);
  });
});
