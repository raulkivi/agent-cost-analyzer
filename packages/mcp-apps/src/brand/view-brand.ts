// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What a view shows about the product that serves it (MCP Apps plan §4.2,
// §5.1). The server derives it from McpIdentity and injects it as JSON into
// <meta name="aca-brand">. The type is copied here rather than shared via
// the domain package: it is a wire contract between two bundles, it belongs
// to the MCP layer (it is derived from McpIdentity, which domain does not
// know), and the view bundle must not import server code. readBrand's tests
// and the server's view-brand tests pin the same shape.
export interface ViewBrand {
  productId: "vscode-extension" | "standalone";
  displayName: string;
  version: string;
  deepLinkBase?: string;
}

// Shown when the placeholder was never filled (a bare build, a dev server).
export const GENERIC_BRAND: ViewBrand = {
  productId: "standalone",
  displayName: "Agent Cost Analyzer",
  version: "",
};
