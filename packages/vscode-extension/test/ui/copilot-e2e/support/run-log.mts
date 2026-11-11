// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What the real-Copilot specs tell the release evidence (G2) that wdio can't:
// why a test skipped (mocha keeps no reason), which model Copilot ran, and the
// AI Credits spent. Appended to the run's evidence directory, which the config
// passes to the workers through COPILOT_E2E_ROOT_ENV.
import path from "node:path";
import process from "node:process";
import type { RunLogEntry } from "../../../../scripts/release-evidence/build.mts";
import { appendRunLog } from "../../../../scripts/release-evidence/run-artifacts.mts";

export const COPILOT_E2E_ROOT_ENV = "AI_CREDITS_ANALYZER_COPILOT_E2E_ROOT";

export function evidenceDirOf(root: string): string {
  return path.join(root, "evidence");
}

export function logToRun(entry: RunLogEntry): void {
  const root = process.env[COPILOT_E2E_ROOT_ENV];
  if (root !== undefined && root !== "") appendRunLog(evidenceDirOf(root), entry);
}

function skipWith(context: Mocha.Context, scope: "test" | "suite", title: string, reason: string): never {
  logToRun({ kind: "skip", scope, title, reason });
  console.log(`[copilot-e2e] SKIPPED: ${reason}`);
  context.skip();
}

// From inside a test.
export function skipTest(context: Mocha.Context, reason: string): never {
  return skipWith(context, "test", context.test?.title ?? "", reason);
}

// From a suiteSetup hook: every test of the suite is skipped.
export function skipSuite(context: Mocha.Context, reason: string): never {
  return skipWith(context, "suite", context.test?.parent?.title ?? "", reason);
}
