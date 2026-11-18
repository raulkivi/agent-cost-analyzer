// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ClientSetup } from "../../../server/src/mcp/client-setup/client-setup.js";
import { MCP_SERVER_NAME } from "../../../server/src/mcp/client-setup/launch-spec.js";
import type { JsonValue } from "./config-file-store.js";
import { installMode } from "./registration-status.js";
import type {
  InstallPlan,
  RegistrationStatus,
  SetupAction,
} from "./mcp-client-target.js";

export const run = (
  argv: readonly string[],
): Extract<SetupAction, { kind: "run" }> => ({
  kind: "run",
  file: argv[0] ?? "",
  args: argv.slice(1),
});

/** How to put back an entry the client's own `remove` dropped. */
export interface CliRestore {
  label: string;
  /** Steps that restore `existing` by hand, e.g. an `add-json` command. */
  restore(existing: JsonValue): string;
}

// The client keeps no backup of its own, so this text is the only way back.
function lostEntryText(client: CliRestore, existing: JsonValue): string {
  return (
    `${MCP_SERVER_NAME} is no longer registered in ${client.label}: ` +
    `its old entry was removed, then the add failed.\n` +
    client.restore(existing)
  );
}

/**
 * Install plan for clients that register through their own `mcp add`
 * command and refuse (or may refuse) a name that exists, so a changed
 * entry is remove then add, after confirmation.
 */
export function planCliInstall(
  setup: ClientSetup,
  current: RegistrationStatus,
  client: CliRestore,
): InstallPlan {
  const mode = installMode(current);
  const { command, remove } = setup;
  if (!command) throw new Error(`${setup.client} setup has no add command`);
  if (mode === "add")
    return {
      status: current,
      actions: [run(command)],
      needsConfirmation: false,
    };
  if (mode !== "replace" || current.kind !== "registered")
    return { status: current, actions: [], needsConfirmation: false };
  if (!remove) throw new Error(`${setup.client} setup has no remove command`);
  const add: SetupAction = {
    ...run(command),
    onFailure: lostEntryText(client, current.existing),
  };
  return {
    status: current,
    actions: [run(remove), add],
    needsConfirmation: true,
  };
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
