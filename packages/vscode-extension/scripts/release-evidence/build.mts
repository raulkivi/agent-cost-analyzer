// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Builds the release evidence record (evidence.mts) from what a real-Copilot
// run leaves behind: the results reporter's test states, and the run log the
// specs append to (skip reasons, observed model ids, AI Credits). Mocha has no
// skip reason, so the specs write it themselves.
import { COPILOT_E2E_SUITE, EVIDENCE_SCHEMA, type EvidenceTest, type ReleaseEvidence } from "./evidence.mts";

export type RunLogEntry =
  // `title` is the test's title for scope "test", the suite's for scope "suite"
  // (a skip in suiteSetup skips every test of that suite).
  | { kind: "skip"; scope: "test" | "suite"; title: string; reason: string }
  | { kind: "observed-model"; model: string }
  | { kind: "credits"; spent: number };

// wdio's TestStats state, with the title of the suite the test is in.
export interface ReporterTestResult {
  title: string;
  parent: string;
  state: "passed" | "failed" | "skipped" | "pending";
}

export interface RunFacts {
  commit: string;
  dirty: boolean;
  extensionVersion: string;
  vscodeVersion: string;
  requestedModel: string;
  ranAt: Date;
}

export function serializeRunLogEntry(entry: RunLogEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

function isEntry(value: unknown): value is RunLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  switch (entry.kind) {
    case "skip":
      return (entry.scope === "test" || entry.scope === "suite") && typeof entry.title === "string" && typeof entry.reason === "string";
    case "observed-model":
      return typeof entry.model === "string";
    case "credits":
      return typeof entry.spent === "number" && Number.isFinite(entry.spent);
    default:
      return false;
  }
}

export function parseRunLog(text: string): RunLogEntry[] {
  return text.split("\n").flatMap((line, index) => {
    if (line.trim() === "") return [];
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      value = undefined;
    }
    if (!isEntry(value)) throw new Error(`The copilot-e2e run log has a malformed entry on line ${index + 1}.`);
    return [value];
  });
}

function skipReason(result: ReporterTestResult, log: readonly RunLogEntry[]): string | null {
  const skips = log.filter((entry) => entry.kind === "skip");
  const own = skips.findLast((entry) => entry.scope === "test" && entry.title === result.title);
  const suite = skips.findLast((entry) => entry.scope === "suite" && entry.title === result.parent);
  return (own ?? suite)?.reason ?? null;
}

function toTest(result: ReporterTestResult, log: readonly RunLogEntry[]): EvidenceTest {
  const state = result.state === "pending" ? "skipped" : result.state;
  return { title: result.title, state, skipReason: state === "skipped" ? skipReason(result, log) : null };
}

export function buildEvidence(facts: RunFacts, results: readonly ReporterTestResult[], log: readonly RunLogEntry[]): ReleaseEvidence {
  const observed = [...new Set(log.flatMap((entry) => (entry.kind === "observed-model" ? [entry.model] : [])))];
  const credits = log.flatMap((entry) => (entry.kind === "credits" ? [entry.spent] : []));
  return {
    schema: EVIDENCE_SCHEMA,
    suite: COPILOT_E2E_SUITE,
    commit: facts.commit,
    dirty: facts.dirty,
    extensionVersion: facts.extensionVersion,
    vscodeVersion: facts.vscodeVersion,
    model: { requested: facts.requestedModel, observed },
    tests: results.map((result) => toTest(result, log)),
    aiCreditsSpent: credits.length === 0 ? null : credits.reduce((sum, spent) => sum + spent, 0),
    ranAt: facts.ranAt.toISOString(),
  };
}
