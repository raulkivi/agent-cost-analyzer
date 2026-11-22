// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { demoPath } from "./xdg-open-wrapper.mts";

export interface TerminalEnvOptions {
  home: string;
  binDir: string;
  display: string;
  now: string;
  demoForbidden: string | undefined;
}

// Variables that would point the CLI at the owner's data, or make it skip opening a browser.
const DROPPED = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "COPILOT_HOME", "APPDATA", "WAYLAND_DISPLAY", "CI", "BROWSER"];

// §4 "N1 terminal" of https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/demo-recordings-1.0.md.
export function terminalEnv(o: TerminalEnvOptions, base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string | undefined> = { ...base };
  for (const name of DROPPED) delete env[name];
  Object.assign(env, {
    HOME: o.home,
    DISPLAY: o.display,
    PATH: demoPath(o.binDir, base.PATH ?? ""),
    AGENT_COST_ANALYZER_NOW: o.now,
    PS1: "$ ",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    ...(o.demoForbidden === undefined ? {} : { DEMO_FORBIDDEN: o.demoForbidden }),
  });
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined));
}
