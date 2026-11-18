// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

export const MCP_SERVER_NAME = "agent-cost-analyzer";

export interface McpLaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
}

export interface LaunchSpecOptions {
  readonly version: string;
  readonly pin: boolean;
  readonly projectBillingDetails: boolean;
  readonly platform: NodeJS.Platform;
  /** Per-client: only Claude Code's docs ask for `cmd /c npx` on Windows. */
  readonly windowsCmdWrap: boolean;
}

// Strict on purpose: the version lands in argv and in files that clients
// execute, so anything beyond semver characters is rejected.
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function buildLaunchSpec(o: LaunchSpecOptions): McpLaunchSpec {
  if (o.pin && !SEMVER.test(o.version)) {
    throw new Error(`Cannot pin: version ${JSON.stringify(o.version)} is not a semantic version`);
  }
  const pkg = o.pin ? `${MCP_SERVER_NAME}@${o.version}` : MCP_SERVER_NAME;
  const rest = [
    "-y",
    "--prefer-offline",
    pkg,
    "mcp",
    ...(o.projectBillingDetails ? ["--project-billing-details"] : []),
  ];
  return o.windowsCmdWrap && o.platform === "win32"
    ? { command: "cmd", args: ["/c", "npx", ...rest] }
    : { command: "npx", args: rest };
}
