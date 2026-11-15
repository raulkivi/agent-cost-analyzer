// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Where the extension's third-party notices (the .vsix's THIRD-PARTY-NOTICES.md)
// come from: the esbuild metafiles of its two bundles and the package lists of
// the webview's and the MCP App views' Vite builds. Pure paths, shared by
// build.mts and the notices test.
import path from "node:path";

export interface ExtensionNoticesPlan {
  packageDir: string;
  // The esbuild metafiles build.mts writes beside the bundles (not shipped).
  hostMetafilePath: string;
  mcpMetafilePath: string;
  // The package lists the webview's (`--mode extension`) and the views' Vite builds write.
  webviewPackagesPath: string;
  viewsPackagesPath: string;
  noticesPath: string;
}

export function extensionNoticesPlan(packageDir: string): ExtensionNoticesPlan {
  const packages = path.join(packageDir, "..");
  return {
    packageDir,
    hostMetafilePath: path.join(packageDir, "dist", "meta.json"),
    mcpMetafilePath: path.join(packageDir, "dist", "meta-mcp-stdio.json"),
    webviewPackagesPath: path.join(packages, "web", "build", "bundled-packages-extension.json"),
    viewsPackagesPath: path.join(packages, "mcp-apps", "build", "bundled-packages.json"),
    noticesPath: path.join(packageDir, "THIRD-PARTY-NOTICES.md"),
  };
}
