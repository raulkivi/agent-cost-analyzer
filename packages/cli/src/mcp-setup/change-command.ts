// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { applyActions } from "./apply-actions.js";
import {
  isChange,
  planClient,
  type ChangeMode,
  type PlannedClient,
} from "./plan-client.js";
import { formatPlanned, hasChanges } from "./print-plan.js";
import { resolveClients } from "./resolve-clients.js";
import type { InstallCommand, UninstallCommand } from "./setup-args.js";
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  type SetupDeps,
} from "./setup-deps.js";

const QUESTION = "Apply these changes? [y/N] ";

// A failure's later lines (how to restore an entry) read as its details.
const indentRest = (text: string) => text.replaceAll("\n", "\n  ");

async function applyAll(
  planned: readonly PlannedClient[],
  deps: SetupDeps,
): Promise<number> {
  let exit = EXIT_OK;
  for (const client of planned.filter((p) => p.actions.some(isChange))) {
    // Held until the client's own result line, so they read as its details.
    const details: string[] = [];
    const result = await applyActions(client.actions, {
      store: deps.store,
      runner: deps.runner,
      say: (line) => details.push(`  ${line}\n`),
    });
    if (result.ok) deps.io.out(`${client.label}: done\n`);
    else {
      exit = EXIT_FAILED;
      deps.io.err(`${client.label}: failed: ${indentRest(result.message)}\n`);
    }
    for (const line of details) deps.io.out(line);
  }
  return exit;
}

/** Whether to go ahead; says why not when it does not. */
async function authorized(
  yes: boolean,
  deps: SetupDeps,
): Promise<{ go: true } | { go: false; exit: number }> {
  if (yes) return { go: true };
  if (!deps.io.interactive) {
    deps.io.err(
      "Not applying: there is no terminal to ask. Pass --yes to apply.\n",
    );
    return { go: false, exit: EXIT_FAILED };
  }
  if (await deps.io.confirm(QUESTION)) return { go: true };
  deps.io.out("Canceled; nothing changed.\n");
  return { go: false, exit: EXIT_OK };
}

/** Shared flow of install and uninstall: plan, show, confirm, apply. */
export async function changeCommand(
  command: InstallCommand | UninstallCommand,
  deps: SetupDeps,
): Promise<number> {
  const request: ChangeMode =
    command.kind === "mcp-install"
      ? {
          mode: "install",
          pin: command.pin,
          projectBillingDetails: command.projectBillingDetails,
        }
      : { mode: "uninstall" };
  const resolved = await resolveClients(
    command.clients,
    command.scope,
    request.mode,
    deps,
  );
  if (resolved.kind === "usage-error") {
    deps.io.err(`${resolved.message}\n`);
    return EXIT_USAGE;
  }
  for (const note of resolved.notes) deps.io.out(`${note}\n`);
  if (resolved.entries.length === 0) {
    deps.io.out("No supported client found. Name one with --client <id>.\n");
    return EXIT_OK;
  }

  const planned: PlannedClient[] = [];
  for (const entry of resolved.entries)
    planned.push(await planClient(entry, command.scope, request, deps));
  for (const client of planned)
    deps.io.out(`${formatPlanned(client, request.mode)}\n\n`);
  // A refused config file is a request not met, like a planning error.
  const planFailed = planned.some(
    (p) => p.error !== undefined || p.status?.kind === "unreadable",
  );
  const failedExit = planFailed ? EXIT_FAILED : EXIT_OK;

  if (!hasChanges(planned)) {
    deps.io.out("Nothing to change.\n");
    return failedExit;
  }
  if (command.dryRun) {
    deps.io.out("Dry run: nothing was changed.\n");
    return failedExit;
  }
  const decision = await authorized(command.yes, deps);
  if (!decision.go) return decision.exit;
  return (await applyAll(planned, deps)) || failedExit;
}
