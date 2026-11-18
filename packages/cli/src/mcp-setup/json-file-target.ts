// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type {
  McpClientId,
  McpScope,
} from "../../../server/src/mcp/client-setup/client-setup.js";
import { MCP_SERVER_NAME } from "../../../server/src/mcp/client-setup/launch-spec.js";
import type { ClientEnv } from "./client-env.js";
import type { ConfigFileStore, JsonValue } from "./config-file-store.js";
import type { McpClientTarget, SetupAction } from "./mcp-client-target.js";
import {
  installMode,
  readRegistration,
  requireScope,
} from "./registration-status.js";

export interface JsonFileClient {
  id: McpClientId;
  label: string;
  detect(env: ClientEnv): Promise<boolean>;
  configPath(scope: McpScope, env: ClientEnv): string;
  /** Object holding the servers; Claude Desktop and Cursor use mcpServers. */
  keyPath?: readonly string[];
  /** True when another product already supplies the server (VS Code D6). */
  providedElsewhere?(env: ClientEnv): Promise<boolean>;
  /** Appended after install and uninstall actions, e.g. a restart reminder. */
  followUp?: readonly SetupAction[];
}

const DEFAULT_KEY_PATH = ["mcpServers"] as const;

/** Clients whose whole setup is one entry in a JSON file: no CLI to run. */
export function createJsonFileTarget(
  deps: { store: ConfigFileStore },
  client: JsonFileClient,
): McpClientTarget {
  const followUp = client.followUp ?? [];
  const keyPath = client.keyPath ?? DEFAULT_KEY_PATH;
  const ref = (scope: McpScope, env: ClientEnv) => ({
    path: client.configPath(scope, env),
    keyPath,
    name: MCP_SERVER_NAME,
  });

  const status: McpClientTarget["status"] = async (scope, env, expected) => {
    requireScope(client.id, scope);
    if (await client.providedElsewhere?.(env))
      return { kind: "provided-by-extension" };
    if (!(await client.detect(env))) return { kind: "not-detected" };
    return readRegistration(deps.store, ref(scope, env), expected.launch);
  };

  return {
    id: client.id,
    label: client.label,
    detect: client.detect,
    status,

    async planInstall(setup, env) {
      const current = await status(setup.scope, env, setup);
      const mode = installMode(current);
      if (mode === "skip" || mode === "none")
        return { status: current, actions: [], needsConfirmation: false };
      if (!setup.json) throw new Error(`${client.id} setup has no JSON entry`);
      const merge: SetupAction = {
        kind: "merge-json",
        path: client.configPath(setup.scope, env),
        keyPath: setup.json.keyPath,
        name: setup.json.name,
        entry: setup.json.entry as JsonValue,
        replace: mode === "replace",
      };
      return {
        status: current,
        actions: [merge, ...followUp],
        needsConfirmation: mode === "replace",
      };
    },

    async planUninstall(scope, env) {
      // Only presence matters here, so the expected launch is a placeholder.
      const current = await status(scope, env, {
        client: client.id,
        scope,
        launch: { command: "", args: [] },
      });
      if (current.kind !== "registered")
        return { status: current, actions: [] };
      return {
        status: current,
        actions: [{ kind: "remove-json", ...ref(scope, env) }, ...followUp],
      };
    },
  };
}
