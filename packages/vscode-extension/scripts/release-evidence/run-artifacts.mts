// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Files a real-Copilot run leaves in its temp evidence directory: one
// results file per wdio worker (the results reporter) and one run log the
// specs append to. The launcher reads them back in onComplete.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseRunLog, type ReporterTestResult, type RunLogEntry, serializeRunLogEntry } from "./build.mts";

const RUN_LOG = "run-log.jsonl";
const RESULTS = /^results-(.+)\.json$/;
const STATES: readonly string[] = ["passed", "failed", "skipped", "pending"];

export function writeWorkerResults(dir: string, cid: string, results: readonly ReporterTestResult[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `results-${cid}.json`), JSON.stringify(results));
}

export function appendRunLog(dir: string, entry: RunLogEntry): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, RUN_LOG), serializeRunLogEntry(entry));
}

function isResult(value: unknown): value is ReporterTestResult {
  const result = value as Record<string, unknown> | null;
  return (
    typeof result === "object" &&
    result !== null &&
    typeof result.title === "string" &&
    typeof result.parent === "string" &&
    typeof result.state === "string" &&
    STATES.includes(result.state)
  );
}

function readResults(dir: string, name: string): ReporterTestResult[] {
  const value: unknown = JSON.parse(readFileSync(path.join(dir, name), "utf-8"));
  if (!Array.isArray(value) || !value.every(isResult)) throw new Error(`${name} in ${dir} isn't a list of test results.`);
  return value;
}

export function readRunArtifacts(dir: string): { results: ReporterTestResult[]; log: RunLogEntry[] } {
  if (!existsSync(dir)) return { results: [], log: [] };
  const files = readdirSync(dir)
    .filter((name) => RESULTS.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const logFile = path.join(dir, RUN_LOG);
  return {
    results: files.flatMap((name) => readResults(dir, name)),
    log: existsSync(logFile) ? parseRunLog(readFileSync(logFile, "utf-8")) : [],
  };
}
