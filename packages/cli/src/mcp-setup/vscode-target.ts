// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpClientId } from "../../../server/src/mcp/client-setup/client-setup.js";
import {
  vscodeConfigPath,
  vscodeExtensionsDir,
  vscodeInsidersConfigPath,
  vscodeInsidersExtensionsDir,
  vscodeInsidersUserDir,
  vscodeUserDir,
} from "./client-paths.js";
import type { ClientEnv } from "./client-env.js";
import type { ConfigFileStore } from "./config-file-store.js";
import { createJsonFileTarget } from "./json-file-target.js";
import type { McpClientTarget } from "./mcp-client-target.js";

// Extension folders are `<publisher>.<name>-<version>`, lower-cased.
const EXTENSION_FOLDER_PREFIX = "raulkivi.ai-credits-analyzer-";

interface VscodeVariant {
  readonly id: Extract<McpClientId, "vscode" | "vscode-insiders">;
  readonly label: string;
  readonly command: string;
  readonly userDir: (env: ClientEnv) => string;
  readonly configPath: (env: ClientEnv) => string;
  readonly extensionsDir: (env: ClientEnv) => string;
}

const STABLE: VscodeVariant = {
  id: "vscode",
  label: "VS Code",
  command: "code",
  userDir: vscodeUserDir,
  configPath: vscodeConfigPath,
  extensionsDir: vscodeExtensionsDir,
};

const INSIDERS: VscodeVariant = {
  id: "vscode-insiders",
  label: "VS Code Insiders",
  command: "code-insiders",
  userDir: vscodeInsidersUserDir,
  configPath: vscodeInsidersConfigPath,
  extensionsDir: vscodeInsidersExtensionsDir,
};

/**
 * VS Code's user `mcp.json` is edited directly (no `code --add-mcp`, whose
 * JSON argument cmd.exe would mangle); the servers live under `servers`.
 * Stable and Insiders share this shape and differ only in their folders.
 */
function createVscodeFamilyTarget(
  deps: { store: ConfigFileStore },
  variant: VscodeVariant,
): McpClientTarget {
  return createJsonFileTarget(deps, {
    id: variant.id,
    label: variant.label,
    keyPath: ["servers"],
    detect: async (env: ClientEnv) =>
      (await env.onPath(variant.command)) || env.exists(variant.userDir(env)),
    configPath: (_scope, env) => variant.configPath(env),
    // Found by listing the extensions folder: `code --list-extensions` would
    // start VS Code, and adapters never run commands.
    providedElsewhere: async (env) =>
      (await env.readDir(variant.extensionsDir(env))).some((f) =>
        f.startsWith(EXTENSION_FOLDER_PREFIX),
      ),
  });
}

export function createVscodeTarget(deps: {
  store: ConfigFileStore;
}): McpClientTarget {
  return createVscodeFamilyTarget(deps, STABLE);
}

export function createVscodeInsidersTarget(deps: {
  store: ConfigFileStore;
}): McpClientTarget {
  return createVscodeFamilyTarget(deps, INSIDERS);
}
