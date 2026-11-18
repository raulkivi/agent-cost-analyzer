// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  vscodeConfigPath,
  vscodeExtensionsDir,
  vscodeUserDir,
} from "./client-paths.js";
import type { ClientEnv } from "./client-env.js";
import type { ConfigFileStore } from "./config-file-store.js";
import { createJsonFileTarget } from "./json-file-target.js";
import type { McpClientTarget } from "./mcp-client-target.js";

// Extension folders are `<publisher>.<name>-<version>`, lower-cased.
const EXTENSION_FOLDER_PREFIX = "raulkivi.ai-credits-analyzer-";

/**
 * Found by listing the extensions folder: `code --list-extensions` would
 * start VS Code, and adapters never run commands.
 */
async function hasAnalyzerExtension(env: ClientEnv): Promise<boolean> {
  const folders = await env.readDir(vscodeExtensionsDir(env));
  return folders.some((f) => f.startsWith(EXTENSION_FOLDER_PREFIX));
}

/**
 * VS Code's user `mcp.json` is edited directly (no `code --add-mcp`, whose
 * JSON argument cmd.exe would mangle); the servers live under `servers`.
 */
export function createVscodeTarget(deps: {
  store: ConfigFileStore;
}): McpClientTarget {
  return createJsonFileTarget(deps, {
    id: "vscode",
    label: "VS Code",
    keyPath: ["servers"],
    detect: async (env) =>
      (await env.onPath("code")) || env.exists(vscodeUserDir(env)),
    configPath: (_scope, env) => vscodeConfigPath(env),
    providedElsewhere: hasAnalyzerExtension,
  });
}
