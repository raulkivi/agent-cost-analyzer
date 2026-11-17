// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { terminalEnv } from "./terminal-env.mts";

const base = { home: "/tmp/h", binDir: "/tmp/bin", display: ":91", now: "2026-11-06T12:00:00.000Z", demoForbidden: "alice,bob" };

describe("terminalEnv", () => {
  it("sets the made-up home, the fixed clock, a bare prompt and quiet npm", () => {
    const env = terminalEnv(base, { PATH: "/usr/bin", USER: "x" });
    expect(env).toMatchObject({
      HOME: "/tmp/h",
      DISPLAY: ":91",
      AGENT_COST_ANALYZER_NOW: "2026-11-06T12:00:00.000Z",
      PS1: "$ ",
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
      DEMO_FORBIDDEN: "alice,bob",
      PATH: "/tmp/bin:/usr/bin",
    });
  });
  it("drops what would point at the owner's data or stop the CLI opening a browser", () => {
    const env = terminalEnv(base, { XDG_CONFIG_HOME: "/real", COPILOT_HOME: "/real", APPDATA: "/real", WAYLAND_DISPLAY: "w", CI: "1" });
    for (const k of ["XDG_CONFIG_HOME", "COPILOT_HOME", "APPDATA", "WAYLAND_DISPLAY", "CI"]) expect(env).not.toHaveProperty(k);
  });
  it("keeps DEMO_FORBIDDEN out of the env when it is unset", () => {
    expect(terminalEnv({ ...base, demoForbidden: undefined }, {})).not.toHaveProperty("DEMO_FORBIDDEN");
  });
});
