// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type {
  ClientSetup,
  McpClientId,
  McpScope,
} from "../../../server/src/mcp/client-setup/client-setup.js";
import type { LaunchKind } from "./classify-launch.js";
import type { ClientEnv } from "./client-env.js";
import type { JsonValue } from "./config-file-store.js";

/** One step of a plan. Adapters only describe steps; MC5 executes them. */
export type SetupAction =
  | { kind: "run"; file: string; args: readonly string[] }
  | {
      kind: "merge-json";
      path: string;
      keyPath: readonly string[];
      name: string;
      entry: JsonValue;
      replace: boolean;
    }
  | {
      kind: "remove-json";
      path: string;
      keyPath: readonly string[];
      name: string;
    }
  | { kind: "note"; text: string };

export type RegistrationStatus =
  | { kind: "not-detected" }
  | { kind: "not-registered" }
  | {
      kind: "registered";
      launch: LaunchKind;
      /** Command and args equal the expected launch; type and env are ignored. */
      matches: boolean;
    }
  | { kind: "unreadable"; message: string };

export interface InstallPlan {
  status: RegistrationStatus;
  actions: SetupAction[];
  /** True when the plan replaces an entry that differs from the expected one. */
  needsConfirmation: boolean;
}

export interface UninstallPlan {
  status: RegistrationStatus;
  actions: SetupAction[];
}

/**
 * One MCP client. A new client is a new implementation; the commands do not
 * change. Implementations read status and plan actions, never write.
 */
export interface McpClientTarget {
  readonly id: McpClientId;
  readonly label: string;
  detect(env: ClientEnv): Promise<boolean>;
  status(
    scope: McpScope,
    env: ClientEnv,
    expected: ClientSetup,
  ): Promise<RegistrationStatus>;
  planInstall(setup: ClientSetup, env: ClientEnv): Promise<InstallPlan>;
  planUninstall(scope: McpScope, env: ClientEnv): Promise<UninstallPlan>;
}
