// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createClaudeCodeTarget } from "./claude-code-target.js";
import { createClaudeDesktopTarget } from "./claude-desktop-target.js";
import type { ConfigFileStore } from "./config-file-store.js";
import { createCursorTarget } from "./cursor-target.js";
import { createCodexTarget } from "./codex-target.js";
import { createGeminiTarget } from "./gemini-target.js";
import type { McpClientTarget } from "./mcp-client-target.js";
import { createVscodeTarget } from "./vscode-target.js";

/** The one list of supported clients; a new client adds a line here. */
export function createClientTargets(deps: {
  store: ConfigFileStore;
}): readonly McpClientTarget[] {
  return [
    createClaudeCodeTarget(deps),
    createClaudeDesktopTarget(deps),
    createCursorTarget(deps),
    createVscodeTarget(deps),
    createCodexTarget(),
    createGeminiTarget(deps),
  ];
}
