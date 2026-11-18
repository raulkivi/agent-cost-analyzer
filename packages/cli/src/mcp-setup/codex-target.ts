// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { classifyLaunch } from "./classify-launch.js";
import type { ClientEnv } from "./client-env.js";
import { codexConfigPath, codexHome } from "./client-paths.js";
import { findCodexServerTable } from "./codex-config.js";
import type {
  McpClientTarget,
  RegistrationStatus,
} from "./mcp-client-target.js";
import { run } from "./cli-command-plans.js";
import {
  removalSetup,
  requireScope,
  sameLaunch,
} from "./registration-status.js";

const CODEX = "codex";

async function readStatus(
  env: ClientEnv,
  expected: { command: string; args: readonly string[] },
): Promise<RegistrationStatus> {
  let text: string | undefined;
  try {
    text = await env.readText(codexConfigPath(env));
  } catch (error) {
    return { kind: "unreadable", message: (error as Error).message };
  }
  const table = text === undefined ? undefined : findCodexServerTable(text);
  if (!table) return { kind: "not-registered" };
  const existing = { ...table };
  // Without both fields the launch is unknown; "custom" would be a claim.
  if (table.command === undefined || table.args === undefined)
    return Object.keys(existing).length > 0
      ? { kind: "registered-unverified", existing }
      : { kind: "registered-unverified" };
  return {
    kind: "registered",
    launch: classifyLaunch(table),
    matches: sameLaunch(table, expected),
    existing,
  };
}

/**
 * Codex has an add command but no remove, and the adapter does not edit
 * TOML: a changed entry is left alone and uninstall only prints the table
 * to delete.
 */
export function createCodexTarget(): McpClientTarget {
  const detect = async (env: ClientEnv) =>
    (await env.onPath(CODEX)) || env.exists(codexHome(env));

  const status: McpClientTarget["status"] = async (scope, env, expected) => {
    requireScope("codex", scope);
    if (!(await detect(env))) return { kind: "not-detected" };
    return readStatus(env, expected.launch);
  };

  return {
    id: "codex",
    label: "Codex CLI",
    detect,
    status,

    async planInstall(setup, env) {
      const current = await status(setup.scope, env, setup);
      if (current.kind !== "not-registered")
        return { status: current, actions: [], needsConfirmation: false };
      if (!setup.command) throw new Error("codex setup has no add command");
      return {
        status: current,
        actions: [run(setup.command)],
        needsConfirmation: false,
      };
    },

    async planUninstall(scope, env) {
      const setup = removalSetup("codex", scope, env.platform);
      const current = await status(scope, env, setup);
      const present =
        current.kind === "registered" ||
        current.kind === "registered-unverified";
      if (!present || !setup.toml) return { status: current, actions: [] };
      return {
        status: current,
        actions: [
          {
            kind: "note",
            text:
              `Codex has no remove command. Delete this table from ` +
              `${codexConfigPath(env)}:\n${setup.toml.trimEnd()}`,
          },
        ],
      };
    },
  };
}
