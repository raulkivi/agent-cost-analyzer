// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CommandRunner } from "./command-runner.js";
import type { ConfigFileStore } from "./config-file-store.js";
import type { SetupAction } from "./mcp-client-target.js";

export interface ApplyDeps {
  store: ConfigFileStore;
  runner: CommandRunner;
  /** Progress lines (notes, backup paths), printed as they happen. */
  say(line: string): void;
}

export type ApplyResult = { ok: true } | { ok: false; message: string };

type Step = { ok: true } | { ok: false; message: string };
const OK: Step = { ok: true };

async function apply(action: SetupAction, deps: ApplyDeps): Promise<Step> {
  switch (action.kind) {
    case "run":
      return deps.runner.run(action.file, action.args);
    case "note":
      deps.say(action.text);
      return OK;
    case "merge-json":
      return mergeStep(action, deps);
    case "remove-json":
      return removeStep(action, deps);
  }
}

async function mergeStep(
  action: Extract<SetupAction, { kind: "merge-json" }>,
  deps: ApplyDeps,
): Promise<Step> {
  const result = await deps.store.merge(action);
  switch (result.kind) {
    case "created-file":
      deps.say(`created ${action.path}`);
      return OK;
    case "added":
    case "replaced":
      deps.say(`backup: ${result.backupPath}`);
      return OK;
    case "unchanged":
      return OK;
    case "conflict":
      return {
        ok: false,
        message: `${action.path} has a different entry; it was left alone`,
      };
    case "invalid-json":
    case "invalid-shape":
    case "unsafe-file":
      return { ok: false, message: result.message };
  }
}

async function removeStep(
  action: Extract<SetupAction, { kind: "remove-json" }>,
  deps: ApplyDeps,
): Promise<Step> {
  const result = await deps.store.remove(action);
  switch (result.kind) {
    case "removed":
      deps.say(`backup: ${result.backupPath}`);
      return OK;
    case "absent":
    case "missing-file":
      return OK;
    case "invalid-json":
    case "invalid-shape":
    case "unsafe-file":
      return { ok: false, message: result.message };
  }
}

function failed(action: SetupAction, message: string): ApplyResult {
  const recovery = action.kind === "run" ? action.onFailure : undefined;
  return { ok: false, message: recovery ? `${message}\n${recovery}` : message };
}

/** In order; stops at the first failure so later steps never run on a broken base. */
export async function applyActions(
  actions: readonly SetupAction[],
  deps: ApplyDeps,
): Promise<ApplyResult> {
  for (const action of actions) {
    try {
      const step = await apply(action, deps);
      if (!step.ok) return failed(action, step.message);
    } catch (error) {
      return failed(
        action,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return { ok: true };
}
