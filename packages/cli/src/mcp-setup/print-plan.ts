// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describeAction, installStatusWords, statusWords } from "./describe.js";
import {
  isChange,
  type ChangeMode,
  type PlannedClient,
  type Replacing,
} from "./plan-client.js";

const indent = (text: string, by = "    ") =>
  text
    .split("\n")
    .map((line) => by + line)
    .join("\n");

const CODEX_HINT =
  "registered, differs; delete the [mcp_servers.agent-cost-analyzer] table in ~/.codex/config.toml to change it";

function statusText(planned: PlannedClient, mode: ChangeMode["mode"]) {
  if (planned.error) return planned.error;
  const { status } = planned;
  if (!status) return "unknown";
  if (mode === "uninstall") return statusWords(status);
  // Codex's CLI cannot replace a table, so a differing one gets no action.
  if (
    status.kind === "registered" &&
    !status.matches &&
    !planned.actions.some(isChange)
  )
    return planned.id === "codex" ? CODEX_HINT : "registered, differs";
  return installStatusWords(status);
}

// Both entries in full, so the user can see what goes and keep a copy:
// Claude Code and Gemini replace through their own CLI and keep no backup.
function replaceLines(label: string, replacing?: Replacing): string[] {
  if (!replacing) return ["  This replaces your existing entry."];
  const safety = replacing.backupPath
    ? `; the file is backed up to ${replacing.backupPath} first.`
    : `. ${label} keeps no backup; if the add fails, how to restore it is printed.`;
  return [
    `  This replaces your existing entry${safety}`,
    `    old: ${JSON.stringify(replacing.existing)}`,
    `    new: ${JSON.stringify(replacing.wanted)}`,
  ];
}

/** One block per client: label, scope, status, then each action in words. */
export function formatPlanned(
  planned: PlannedClient,
  mode: ChangeMode["mode"],
): string {
  const lines = [
    `${planned.label} (${planned.scope} scope): ${statusText(planned, mode)}`,
  ];
  for (const action of planned.actions)
    lines.push(`  - ${describeAction(action)}`);
  if (planned.needsConfirmation)
    lines.push(...replaceLines(planned.label, planned.replacing));
  if (planned.snippet)
    lines.push("  Register it by hand instead:", indent(planned.snippet));
  return lines.join("\n");
}

export const hasChanges = (planned: readonly PlannedClient[]) =>
  planned.some((p) => p.actions.some(isChange));
