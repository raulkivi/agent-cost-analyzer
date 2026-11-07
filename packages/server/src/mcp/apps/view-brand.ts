// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What an MCP App view shows about the product that serves it (MCP Apps
// plan §4.2, §5.1), derived from the server's McpIdentity.

import type { McpIdentity } from "../mcp-identity.js";

export interface ViewBrand {
  productId: "vscode-extension" | "standalone";
  displayName: string;
  version: string;
  deepLinkBase?: string;
}

// The extension's MCP server is the only one named "ai-credits-analyzer";
// every other identity is the standalone product.
const EXTENSION_SERVER_NAME = "ai-credits-analyzer";

export function toViewBrand(identity: McpIdentity, version: string): ViewBrand {
  return {
    productId: identity.name === EXTENSION_SERVER_NAME ? "vscode-extension" : "standalone",
    displayName: identity.title,
    version,
    ...(identity.deepLinkBase !== undefined ? { deepLinkBase: identity.deepLinkBase } : {}),
  };
}
