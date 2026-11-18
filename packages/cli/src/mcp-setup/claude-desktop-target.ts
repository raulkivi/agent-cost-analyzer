// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { claudeDesktopConfigPath, pathFlavor } from "./client-paths.js";
import type { ConfigFileStore } from "./config-file-store.js";
import { createJsonFileTarget } from "./json-file-target.js";
import type { McpClientTarget } from "./mcp-client-target.js";

export function createClaudeDesktopTarget(deps: {
  store: ConfigFileStore;
}): McpClientTarget {
  return createJsonFileTarget(deps, {
    id: "claude-desktop",
    label: "Claude Desktop",
    // The config folder exists once the app has run; the file may not yet.
    detect: (env) =>
      env.exists(
        pathFlavor(env.platform).dirname(claudeDesktopConfigPath(env)),
      ),
    configPath: (_scope, env) => claudeDesktopConfigPath(env),
    followUp: [
      { kind: "note", text: "Restart Claude Desktop to load the server." },
    ],
  });
}
