// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { cursorConfigPath, pathFlavor } from "./client-paths.js";
import type { ConfigFileStore } from "./config-file-store.js";
import { createJsonFileTarget } from "./json-file-target.js";
import type { McpClientTarget } from "./mcp-client-target.js";

export function createCursorTarget(deps: {
  store: ConfigFileStore;
}): McpClientTarget {
  return createJsonFileTarget(deps, {
    id: "cursor",
    label: "Cursor",
    detect: async (env) =>
      (await env.exists(pathFlavor(env.platform).join(env.home, ".cursor"))) ||
      env.onPath("cursor"),
    configPath: (scope, env) =>
      cursorConfigPath(scope === "project" ? "project" : "user", env),
  });
}
