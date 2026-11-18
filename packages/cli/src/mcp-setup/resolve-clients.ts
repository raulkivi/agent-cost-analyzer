// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  MCP_CLIENT_IDS,
  supportedScopes,
  type McpClientId,
  type McpScope,
} from "../../../server/src/mcp/client-setup/client-setup.js";
import type { McpClientTarget } from "./mcp-client-target.js";
import type { ClientSelection } from "./setup-args.js";
import type { SetupDeps } from "./setup-deps.js";

/** A client the user asked for; `target` is absent until an adapter exists. */
export interface ClientEntry {
  id: McpClientId;
  target?: McpClientTarget;
}

export type Resolution =
  | { kind: "ok"; entries: ClientEntry[]; notes: string[] }
  | { kind: "usage-error"; message: string };

const supports = (id: McpClientId, scope: McpScope) =>
  supportedScopes(id).includes(scope);

function targetOf(deps: SetupDeps, id: McpClientId) {
  return deps.targets.find((target) => target.id === id);
}

async function detectedEntries(
  scope: McpScope,
  deps: SetupDeps,
): Promise<Resolution> {
  // A prompt-free run must name its clients: guessing would write configs.
  if (!deps.io.interactive)
    return {
      kind: "usage-error",
      message:
        "mcp install without a terminal needs --client <id>[,<id>…] or --client all",
    };
  const entries: ClientEntry[] = [];
  for (const target of deps.targets)
    if (supports(target.id, scope) && (await target.detect(deps.env)))
      entries.push({ id: target.id, target });
  return { kind: "ok", entries, notes: [] };
}

function allEntries(scope: McpScope, deps: SetupDeps): Resolution {
  const entries: ClientEntry[] = [];
  const notes: string[] = [];
  for (const target of deps.targets) {
    if (supports(target.id, scope)) entries.push({ id: target.id, target });
    else notes.push(`${target.label}: no ${scope} scope, skipped`);
  }
  return { kind: "ok", entries, notes };
}

export async function resolveClients(
  selection: ClientSelection,
  scope: McpScope,
  deps: SetupDeps,
): Promise<Resolution> {
  switch (selection.kind) {
    case "detected":
      return detectedEntries(scope, deps);
    case "all":
      return allEntries(scope, deps);
    case "ids": {
      const entries = selection.ids.map((id) => {
        const target = targetOf(deps, id);
        return target ? { id, target } : { id };
      });
      return { kind: "ok", entries, notes: [] };
    }
  }
}

/** Every known client in the documented order, with its adapter if any. */
export function allKnownEntries(deps: SetupDeps): ClientEntry[] {
  return MCP_CLIENT_IDS.map((id) => {
    const target = targetOf(deps, id);
    return target ? { id, target } : { id };
  });
}
