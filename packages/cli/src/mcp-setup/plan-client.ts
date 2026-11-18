// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  clientSetup,
  type McpScope,
} from "../../../server/src/mcp/client-setup/client-setup.js";
import { configText } from "./config-text.js";
import { differsText } from "./describe.js";
import type { RegistrationStatus, SetupAction } from "./mcp-client-target.js";
import type { ClientEntry } from "./resolve-clients.js";
import type { SetupDeps } from "./setup-deps.js";

export interface LaunchChoice {
  pin: boolean;
  projectBillingDetails: boolean;
}

export type ChangeMode =
  ({ mode: "install" } & LaunchChoice) | { mode: "uninstall" };

/** One client's part of the plan, ready to print and to apply. */
export interface PlannedClient {
  id: ClientEntry["id"];
  label: string;
  scope: McpScope;
  /** Absent when planning failed: `error` says why. */
  status?: RegistrationStatus;
  actions: SetupAction[];
  needsConfirmation: boolean;
  /** "latest → pinned 1.0.0" when the plan replaces an entry. */
  differs?: string;
  /** Hand-registration text, shown when the plan cannot act. */
  snippet?: string;
  error?: string;
}

/** Only these change anything; notes just inform. */
export const isChange = (action: SetupAction) => action.kind !== "note";

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
  const differs = plan.needsConfirmation
    ? differsText(plan.status, setup)
    : undefined;
  return {
    status: plan.status,
    actions: plan.actions,
    needsConfirmation: plan.needsConfirmation,
    ...(differs && { differs }),
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
