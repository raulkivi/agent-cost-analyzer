// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ClientSetup } from "../../../server/src/mcp/client-setup/client-setup.js";
import { installMode } from "./registration-status.js";
import type {
  InstallPlan,
  RegistrationStatus,
  SetupAction,
} from "./mcp-client-target.js";

export const run = (argv: readonly string[]): SetupAction => ({
  kind: "run",
  file: argv[0] ?? "",
  args: argv.slice(1),
});

/**
 * Install plan for clients that register through their own `mcp add`
 * command and refuse (or may refuse) a name that exists, so a changed
 * entry is remove then add, after confirmation.
 */
export function planCliInstall(
  setup: ClientSetup,
  current: RegistrationStatus,
): InstallPlan {
  const mode = installMode(current);
  const { command, remove } = setup;
  if (!command) throw new Error(`${setup.client} setup has no add command`);
  const actions: SetupAction[] = [];
  if (mode === "replace") {
    if (!remove) throw new Error(`${setup.client} setup has no remove command`);
    actions.push(run(remove));
  }
  if (mode === "add" || mode === "replace") actions.push(run(command));
  return { status: current, actions, needsConfirmation: mode === "replace" };
}

/** A remove command for a name that is not there fails, so only when registered. */
export function planCliUninstall(
  setup: ClientSetup,
  current: RegistrationStatus,
) {
  const actions =
    current.kind === "registered" && setup.remove ? [run(setup.remove)] : [];
  return { status: current, actions };
}
