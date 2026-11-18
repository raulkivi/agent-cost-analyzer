// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type {
  ClientSetup,
  McpScope,
} from "../../../server/src/mcp/client-setup/client-setup.js";
import { MCP_SERVER_NAME } from "../../../server/src/mcp/client-setup/launch-spec.js";
import type { ClientEnv } from "./client-env.js";
import { pathFlavor } from "./client-paths.js";
import type { ConfigFileStore, JsonEntryRef } from "./config-file-store.js";
import type { McpClientTarget } from "./mcp-client-target.js";
import {
  planCliInstall,
  planCliUninstall,
  type CliRestore,
} from "./cli-command-plans.js";
import {
  projectRootOf,
  readRegistration,
  removalSetup,
  requireScope,
} from "./registration-status.js";
import { shellLine } from "./shell-quote.js";

const CLAUDE = "claude";
const LABEL = "Claude Code";

// `add-json` takes the entry exactly as Claude Code stored it, env included.
const restoreWith = (setup: ClientSetup): CliRestore => ({
  label: LABEL,
  restore: (existing) =>
    "To restore the old entry, run:\n  " +
    shellLine([
      CLAUDE,
      "mcp",
      "add-json",
      "--scope",
      setup.scope,
      MCP_SERVER_NAME,
      JSON.stringify(existing),
    ]),
});

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
        ...projectRootOf(scope, env),
      };
  }
}

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
    label: LABEL,
    detect,
    status,

    async planInstall(setup, env) {
      const current = await status(setup.scope, env, setup);
      return planCliInstall(setup, current, restoreWith(setup));
    },

    async planUninstall(scope, env) {
      const setup = removalSetup("claude-code", scope, env.platform);
      return planCliUninstall(setup, await status(scope, env, setup));
    },
  };
}
