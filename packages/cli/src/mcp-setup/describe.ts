// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { LaunchKind } from "./classify-launch.js";
import type { RegistrationStatus, SetupAction } from "./mcp-client-target.js";
import { shellLine } from "./shell-quote.js";

export function launchWords(launch: LaunchKind): string {
  if (launch === "latest") return "latest";
  if (launch === "custom") return "differs";
  return `pinned ${launch.pinned}`;
}

// Kinds a newer adapter may add; a name we do not know prints as itself.
function unknownKindWords(kind: string): string {
  switch (kind) {
    case "provided-by-extension":
      return "provided by the AI Credits Analyzer extension";
    case "registered-unverified":
      return "registered, launch unknown";
    default:
      return kind;
  }
}

/** The `mcp status` wording; unknown kinds print their name, not a crash. */
export function statusWords(status: RegistrationStatus): string {
  switch (status.kind) {
    case "not-detected":
      return "not detected";
    case "not-registered":
      return "not registered";
    case "registered":
      return `registered (${launchWords(status.launch)})`;
    case "unreadable":
      return `unreadable: ${status.message}`;
    default:
      return unknownKindWords((status as { kind: string }).kind);
  }
}

/** The `mcp install` wording: whether the entry already matches the request. */
export function installStatusWords(status: RegistrationStatus): string {
  if (status.kind === "registered" && status.matches)
    return "already registered";
  return statusWords(status);
}

export function describeAction(action: SetupAction): string {
  switch (action.kind) {
    case "run":
      return `run: ${shellLine([action.file, ...action.args])}`;
    case "merge-json":
      return action.replace
        ? `replace agent-cost-analyzer in ${action.path}`
        : `add agent-cost-analyzer to ${action.path}`;
    case "remove-json":
      return `remove agent-cost-analyzer from ${action.path}`;
    case "note":
      return action.text;
  }
}
