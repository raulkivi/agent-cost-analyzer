// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpScope } from "../../../server/src/mcp/client-setup/client-setup.js";
import { MCP_SERVER_NAME } from "../../../server/src/mcp/client-setup/launch-spec.js";
import {
  planCliInstall,
  planCliUninstall,
  type CliRestore,
} from "./cli-command-plans.js";
import type { ClientEnv } from "./client-env.js";
import { geminiHome, geminiSettingsPath } from "./client-paths.js";
import type { ConfigFileStore, JsonEntryRef } from "./config-file-store.js";
import type { McpClientTarget } from "./mcp-client-target.js";
import {
  projectRootOf,
  readRegistration,
  removalSetup,
  requireScope,
} from "./registration-status.js";

const GEMINI = "gemini";
const LABEL = "Gemini CLI";

const entryRef = (scope: McpScope, env: ClientEnv): JsonEntryRef => ({
  path: geminiSettingsPath(scope === "project" ? "project" : "user", env),
  keyPath: ["mcpServers"],
  name: MCP_SERVER_NAME,
  ...projectRootOf(scope, env),
});

// `gemini mcp add` cannot express every field an entry may hold, so the
// way back is the entry itself and the file it belongs in.
const restoreIn = (ref: JsonEntryRef): CliRestore => ({
  label: LABEL,
  restore: (existing) =>
    `To restore the old entry, put it back under "mcpServers" in ${ref.path}:\n` +
    `  ${JSON.stringify(ref.name)}: ${JSON.stringify(existing)}`,
});

/** Status is read from settings.json; Gemini's own CLI does the writing. */
export function createGeminiTarget(deps: {
  store: ConfigFileStore;
}): McpClientTarget {
  const detect = async (env: ClientEnv) =>
    (await env.onPath(GEMINI)) || env.exists(geminiHome(env));

  const status: McpClientTarget["status"] = async (scope, env, expected) => {
    requireScope("gemini", scope);
    if (!(await detect(env))) return { kind: "not-detected" };
    return readRegistration(deps.store, entryRef(scope, env), expected.launch);
  };

  return {
    id: "gemini",
    label: LABEL,
    detect,
    status,

    async planInstall(setup, env) {
      const ref = entryRef(setup.scope, env);
      const current = await status(setup.scope, env, setup);
      return planCliInstall(setup, current, restoreIn(ref));
    },

    async planUninstall(scope, env) {
      const setup = removalSetup("gemini", scope, env.platform);
      return planCliUninstall(setup, await status(scope, env, setup));
    },
  };
}
