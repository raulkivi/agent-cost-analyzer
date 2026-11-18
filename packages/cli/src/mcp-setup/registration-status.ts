// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  clientSetup,
  supportedScopes,
  type ClientSetup,
  type McpClientId,
  type McpScope,
} from "../../../server/src/mcp/client-setup/client-setup.js";
import type { McpLaunchSpec } from "../../../server/src/mcp/client-setup/launch-spec.js";
import { argsOf, classifyLaunch } from "./classify-launch.js";
import type { ConfigFileStore, JsonEntryRef } from "./config-file-store.js";
import type { RegistrationStatus } from "./mcp-client-target.js";

export function requireScope(client: McpClientId, scope: McpScope): void {
  if (!supportedScopes(client).includes(scope))
    throw new Error(`${client} does not support scope "${scope}"`);
}

/** Reads the entry from the client's own config file; never starts a server. */
export async function readRegistration(
  store: ConfigFileStore,
  ref: JsonEntryRef,
  expected: McpLaunchSpec,
): Promise<RegistrationStatus> {
  const result = await store.read(ref);
  switch (result.kind) {
    case "missing-file":
    case "absent":
      return { kind: "not-registered" };
    case "invalid-json":
    case "invalid-shape":
      return { kind: "unreadable", message: result.message };
    case "present":
      return {
        kind: "registered",
        launch: classifyLaunch(result.entry),
        matches: sameLaunch(result.entry, expected),
      };
  }
}

// Only command and args: Claude Code adds `type` and `env` on its own.
export function sameLaunch(entry: unknown, expected: McpLaunchSpec): boolean {
  const command = (entry as { command?: unknown } | null)?.command;
  const args = argsOf(entry);
  return (
    command === expected.command &&
    args.length === expected.args.length &&
    args.every((arg, i) => arg === expected.args[i])
  );
}

export type InstallMode = "skip" | "none" | "add" | "replace";

export function installMode(status: RegistrationStatus): InstallMode {
  switch (status.kind) {
    case "not-detected":
    case "unreadable":
      return "skip";
    // Nothing to add or replace: something else owns the entry.
    case "registered-unverified":
    case "provided-by-extension":
      return "none";
    case "not-registered":
      return "add";
    case "registered":
      return status.matches ? "none" : "replace";
  }
}

/**
 * Uninstall has no caller-built ClientSetup, yet some clients' remove
 * commands come from one. The version is a placeholder: remove never
 * mentions it.
 */
export function removalSetup(
  client: McpClientId,
  scope: McpScope,
  platform: NodeJS.Platform,
): ClientSetup {
  return clientSetup(client, {
    version: "0.0.0",
    pin: false,
    projectBillingDetails: false,
    platform,
    scope,
  });
}
