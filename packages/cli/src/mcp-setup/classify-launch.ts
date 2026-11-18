// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { MCP_SERVER_NAME } from "../../../server/src/mcp/client-setup/launch-spec.js";

export type LaunchKind = "latest" | { pinned: string } | "custom";

/**
 * Which package spec a registered entry launches. Scans args rather than
 * fixed positions so a `cmd /c npx …` wrapper and future npx flags still
 * classify. Anything else, such as a local checkout, is "custom".
 */
export function classifyLaunch(entry: unknown): LaunchKind {
  const pinnedPrefix = `${MCP_SERVER_NAME}@`;
  for (const arg of argsOf(entry)) {
    if (arg === MCP_SERVER_NAME) return "latest";
    if (arg.startsWith(pinnedPrefix) && arg.length > pinnedPrefix.length)
      return { pinned: arg.slice(pinnedPrefix.length) };
  }
  return "custom";
}

export function argsOf(entry: unknown): string[] {
  if (typeof entry !== "object" || entry === null) return [];
  const args = (entry as { args?: unknown }).args;
  return Array.isArray(args) && args.every((a) => typeof a === "string")
    ? (args as string[])
    : [];
}
