// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpScope } from "../../../server/src/mcp/client-setup/client-setup.js";
import { MCP_SERVER_NAME } from "../../../server/src/mcp/client-setup/launch-spec.js";
import type { ClientEnv } from "./client-env.js";
import { pathFlavor } from "./client-paths.js";
import type { ConfigFileStore, JsonEntryRef } from "./config-file-store.js";
import type { McpClientTarget, SetupAction } from "./mcp-client-target.js";
import {
  installMode,
  readRegistration,
  removalSetup,
  requireScope,
} from "./registration-status.js";

const CLAUDE = "claude";

// Where `claude mcp add --scope <s>` keeps the entry, so status can be read
// from the file: `claude mcp get` would start the server to check it.
function entryRef(scope: McpScope, env: ClientEnv): JsonEntryRef {
  const p = pathFlavor(env.platform);
  const name = MCP_SERVER_NAME;
  switch (scope) {
    case "user":
      return {
        path: p.join(env.home, ".claude.json"),
        keyPath: ["mcpServers"],
        name,
      };
    case "local":
      return {
        path: p.join(env.home, ".claude.json"),
        keyPath: ["projects", env.cwd, "mcpServers"],
        name,
      };
    case "project":
      return {
        path: p.join(env.cwd, ".mcp.json"),
        keyPath: ["mcpServers"],
        name,
      };
  }
}

const run = (argv: readonly string[]): SetupAction => ({
  kind: "run",
  file: argv[0] ?? CLAUDE,
  args: argv.slice(1),
});

export function createClaudeCodeTarget(deps: {
  store: ConfigFileStore;
}): McpClientTarget {
  const detect = (env: ClientEnv) => env.onPath(CLAUDE);

  const status: McpClientTarget["status"] = async (scope, env, expected) => {
    requireScope("claude-code", scope);
    if (!(await detect(env))) return { kind: "not-detected" };
    return readRegistration(deps.store, entryRef(scope, env), expected.launch);
  };

  return {
    id: "claude-code",
    label: "Claude Code",
    detect,
    status,

    async planInstall(setup, env) {
      const current = await status(setup.scope, env, setup);
      const mode = installMode(current);
      const { command, remove } = setup;
      if (!command) throw new Error("claude-code setup has no add command");
      const actions: SetupAction[] = [];
      if (mode === "replace") {
        // claude refuses an existing name, so replacing is remove then add.
        if (!remove) throw new Error("claude-code setup has no remove command");
        actions.push(run(remove));
      }
      if (mode === "add" || mode === "replace") actions.push(run(command));
      return {
        status: current,
        actions,
        needsConfirmation: mode === "replace",
      };
    },

    async planUninstall(scope, env) {
      const setup = removalSetup("claude-code", scope, env.platform);
      const current = await status(scope, env, setup);
      // claude exits 1 when asked to remove a name that is not there.
      const actions =
        current.kind === "registered" && setup.remove
          ? [run(setup.remove)]
          : [];
      return { status: current, actions };
    },
  };
}
