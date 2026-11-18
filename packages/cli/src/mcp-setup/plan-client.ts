// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  clientSetup,
  type ClientSetup,
  type McpScope,
} from "../../../server/src/mcp/client-setup/client-setup.js";
import { BACKUP_SUFFIX, type JsonValue } from "./config-file-store.js";
import { configText } from "./config-text.js";
import type {
  InstallPlan,
  RegistrationStatus,
  SetupAction,
} from "./mcp-client-target.js";
import type { ClientEntry } from "./resolve-clients.js";
import type { SetupDeps } from "./setup-deps.js";

export interface LaunchChoice {
  pin: boolean;
  projectBillingDetails: boolean;
}

export type ChangeMode =
  ({ mode: "install" } & LaunchChoice) | { mode: "uninstall" };

/** The entry a replace drops and the one it writes, both shown in full. */
export interface Replacing {
  existing: JsonValue;
  wanted: JsonValue;
  /** Where a JSON file is backed up; absent when the client's CLI replaces it. */
  backupPath?: string;
}

/** One client's part of the plan, ready to print and to apply. */
export interface PlannedClient {
  id: ClientEntry["id"];
  label: string;
  scope: McpScope;
  /** Absent when planning failed: `error` says why. */
  status?: RegistrationStatus;
  actions: SetupAction[];
  needsConfirmation: boolean;
  /** Set when the plan replaces an entry that differs. */
  replacing?: Replacing;
  /** Hand-registration text, shown when the plan cannot act. */
  snippet?: string;
  error?: string;
}

/** Only these change anything; notes just inform. */
export const isChange = (action: SetupAction) => action.kind !== "note";

function replacingOf(
  plan: InstallPlan,
  setup: ClientSetup,
): Replacing | undefined {
  if (!plan.needsConfirmation || plan.status.kind !== "registered")
    return undefined;
  const merge = plan.actions.find((a) => a.kind === "merge-json");
  const launch = {
    command: setup.launch.command,
    args: [...setup.launch.args],
  };
  return {
    existing: plan.status.existing,
    wanted: merge?.entry ?? (setup.json?.entry as JsonValue) ?? launch,
    ...(merge && { backupPath: merge.path + BACKUP_SUFFIX }),
  };
}

async function planInstall(
  entry: ClientEntry,
  scope: McpScope,
  choice: LaunchChoice,
  deps: SetupDeps,
): Promise<Omit<PlannedClient, "id" | "label" | "scope">> {
  const setup = clientSetup(entry.id, {
    version: deps.version,
    platform: deps.env.platform,
    scope,
    ...choice,
  });
  const plan = await entry.target!.planInstall(setup, deps.env);
  const stuck =
    plan.status.kind === "not-detected" || plan.status.kind === "unreadable";
  const replacing = replacingOf(plan, setup);
  return {
    status: plan.status,
    actions: plan.actions,
    needsConfirmation: plan.needsConfirmation,
    ...(replacing && { replacing }),
    ...(stuck && { snippet: configText(setup) }),
  };
}

async function planUninstall(
  entry: ClientEntry,
  scope: McpScope,
  deps: SetupDeps,
): Promise<Omit<PlannedClient, "id" | "label" | "scope">> {
  const plan = await entry.target!.planUninstall(scope, deps.env);
  return {
    status: plan.status,
    actions: plan.actions,
    needsConfirmation: false,
  };
}

export async function planClient(
  entry: ClientEntry,
  scope: McpScope,
  request: ChangeMode,
  deps: SetupDeps,
): Promise<PlannedClient> {
  const base = {
    id: entry.id,
    label: entry.target?.label ?? entry.id,
    scope,
    actions: [],
    needsConfirmation: false,
  };
  if (!entry.target) return { ...base, error: "not supported yet" };
  try {
    const part =
      request.mode === "install"
        ? await planInstall(entry, scope, request, deps)
        : await planUninstall(entry, scope, deps);
    return { ...base, ...part };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
