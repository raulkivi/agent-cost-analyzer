// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import type { McpServerDeps } from "../mcp-server.js";
import { FileViewSource } from "./view-source.js";

// Phase 12 A13 (docs/plans/mcp-apps.md §4.2, §7): the one place both entry
// points (the standalone stdio.ts and the extension's mcp-stdio.js) turn the
// path of the built views.html into the createMcpServer `appViews` option.
// A missing file (no path, or mcp-apps never built) yields no option at all,
// so the server starts exactly as before, without the views group; FileViewSource
// alone would register the resource and fail only at resources/read.
export function resolveAppViews(
  htmlPath: string | undefined,
  onMissing: (htmlPath: string) => void = () => undefined,
  fileExists: (htmlPath: string) => boolean = existsSync,
): Pick<McpServerDeps, "appViews"> {
  if (!htmlPath) return {};
  if (!fileExists(htmlPath)) {
    onMissing(htmlPath);
    return {};
  }
  return { appViews: { source: new FileViewSource(htmlPath) } };
}
