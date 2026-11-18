// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { changeCommand } from "./change-command.js";
import { configCommand } from "./config-command.js";
import type { SetupCommand } from "./setup-args.js";
import type { SetupDeps } from "./setup-deps.js";
import { statusCommand } from "./status-command.js";

export type SetupRunner = (command: SetupCommand) => Promise<number>;

export function createSetupRunner(deps: SetupDeps): SetupRunner {
  return async (command) => {
    switch (command.kind) {
      case "mcp-config":
        return configCommand(command, deps);
      case "mcp-status":
        return statusCommand(command, deps);
      case "mcp-install":
      case "mcp-uninstall":
        return changeCommand(command, deps);
    }
  };
}
