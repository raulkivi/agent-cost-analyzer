// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  clientSetup,
  supportedScopes,
} from "../../../server/src/mcp/client-setup/client-setup.js";
import { statusWords } from "./describe.js";
import { allKnownEntries, type ClientEntry } from "./resolve-clients.js";
import type { StatusCommand } from "./setup-args.js";
import { EXIT_FAILED, EXIT_OK, type SetupDeps } from "./setup-deps.js";

async function statusLine(
  entry: ClientEntry,
  scope: StatusCommand["scope"],
  deps: SetupDeps,
): Promise<{ text: string; failed: boolean }> {
  const { target } = entry;
  if (!target) return { text: "not supported yet", failed: false };
  if (!supportedScopes(entry.id).includes(scope))
    return { text: `no ${scope} scope`, failed: false };
  try {
    const expected = clientSetup(entry.id, {
      version: deps.version,
      pin: false,
      projectBillingDetails: false,
      platform: deps.env.platform,
      scope,
    });
    return {
      text: statusWords(await target.status(scope, deps.env, expected)),
      failed: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: `error: ${message}`, failed: true };
  }
}

/** One line per client; reads configs, writes nothing. */
export async function statusCommand(
  command: StatusCommand,
  deps: SetupDeps,
): Promise<number> {
  const entries = allKnownEntries(deps);
  const width = Math.max(
    ...entries.map((e) => (e.target?.label ?? e.id).length),
  );
  let exit = EXIT_OK;
  for (const entry of entries) {
    const { text, failed } = await statusLine(entry, command.scope, deps);
    if (failed) exit = EXIT_FAILED;
    const label = (entry.target?.label ?? entry.id).padEnd(width);
    deps.io.out(`${label}  ${text}\n`);
  }
  return exit;
}
