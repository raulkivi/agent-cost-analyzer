// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The real-data checks' read-only rule for the owner's logs. A check runs for
// many minutes beside live agent sessions, so a log can legitimately grow while
// it runs. A log whose write time falls after the run began was written by its
// own session (the checks only read: they copy or link nothing back). A log
// that vanished, or changed with an older write time, would be a write by the
// check. Same rule as the Claude Code subagent check (cs-claude-code-subagents).
import { existsSync, statSync } from "node:fs";

export interface LogStat {
  size: number;
  mtimeMs: number;
}

export function statLogs(files: readonly string[]): Map<string, LogStat> {
  const stats = new Map<string, LogStat>();
  for (const file of files) {
    if (!existsSync(file)) continue;
    const { size, mtimeMs } = statSync(file);
    stats.set(file, { size, mtimeMs });
  }
  return stats;
}

export interface LogWriteReport {
  unchanged: number;
  // Changed with a write time after the run began: written by its own session.
  writtenDuringRun: number;
  // Vanished, or changed without a later write time: the only failures.
  violations: string[];
}

// `tag` names a file in the report without printing its path.
export function compareLogs(before: ReadonlyMap<string, LogStat>, after: ReadonlyMap<string, LogStat>, startedAtMs: number, tag: (file: string) => string = () => "a log file"): LogWriteReport {
  const report: LogWriteReport = { unchanged: 0, writtenDuringRun: 0, violations: [] };
  for (const [file, was] of before) {
    const now = after.get(file);
    if (now === undefined) report.violations.push(`${tag(file)} vanished`);
    else if (now.size === was.size && now.mtimeMs === was.mtimeMs) report.unchanged += 1;
    else if (now.mtimeMs >= startedAtMs) report.writtenDuringRun += 1;
    else report.violations.push(`${tag(file)} changed without a write time after the run began`);
  }
  return report;
}
