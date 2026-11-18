// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { clientSetup } from "../../../server/src/mcp/client-setup/client-setup.js";
import { configText } from "./config-text.js";
import type { ConfigCommand } from "./setup-args.js";
import { EXIT_FAILED, EXIT_OK, type SetupDeps } from "./setup-deps.js";

/** Prints how to register by hand; works for every client, adapter or not. */
export function configCommand(command: ConfigCommand, deps: SetupDeps): number {
  try {
    const setup = clientSetup(command.client, {
      version: deps.version,
      pin: command.pin,
      projectBillingDetails: command.projectBillingDetails,
      platform: deps.env.platform,
      scope: command.scope,
    });
    const label =
      deps.targets.find((t) => t.id === command.client)?.label ??
      command.client;
    deps.io.out(`${label} (${command.scope} scope)\n\n${configText(setup)}\n`);
    return EXIT_OK;
  } catch (error) {
    deps.io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_FAILED;
  }
}
