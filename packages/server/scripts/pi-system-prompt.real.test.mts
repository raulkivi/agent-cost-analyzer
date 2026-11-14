// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Real-data check of the pi system-prompt combination (pi's in-file sections +
// the pi-system-prompt-logger sidecar). Opt-in and local only:
//
//   npm run test:real-data:pi
//   REAL_DATA_PI_SESSIONS=<dir> REAL_DATA_PI_LOG=<file> ...   (default ~/.pi/agent/sessions and ~/.pi/agent/logs/system-prompts.jsonl)
//
// For every session branch that has both a system message in the file and a
// sidecar record, the rebuilt prompt must be exactly the sidecar's
// `systemPromptChars` long and its parts must add up to it. Output and
// assertions carry counts and percentages only: never prompt text, paths or titles.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readPiSessionFile } from "../src/data-sources/pi-agent/pi-jsonl-reader.js";
import { resolvePiSystemPrompt } from "../src/data-sources/pi-agent/resolve-pi-system-prompt.js";
import { findLeafEntryIds, walkBranch } from "../src/data-sources/pi-agent/session-tree.js";
import { buildCombinedSystemPrompt } from "../src/data-sources/pi-agent/system-prompt-combiner.js";
import { replaySystemMessages } from "../src/data-sources/pi-agent/system-message-replay.js";
import { selectSidecarRecord, branchEndTimestamp } from "../src/data-sources/pi-agent/system-prompt-sidecar-matcher.js";
import { readSystemPromptSidecarIndex } from "../src/data-sources/pi-agent/system-prompt-sidecar-reader.js";
import { listPiAgentSessionFiles } from "../src/platform/pi-agent-paths/resolve-pi-agent-sessions-dir.js";

const REAL_DATA = process.env.REAL_DATA === "1";
const sessionsDir = process.env.REAL_DATA_PI_SESSIONS ?? path.join(homedir(), ".pi", "agent", "sessions");
const logPath = process.env.REAL_DATA_PI_LOG ?? path.join(homedir(), ".pi", "agent", "logs", "system-prompts.jsonl");

const skipReason = !REAL_DATA
  ? "set REAL_DATA=1 to run"
  : !existsSync(sessionsDir) || !existsSync(logPath)
    ? "no pi sessions dir or system-prompts.jsonl found (REAL_DATA_PI_SESSIONS, REAL_DATA_PI_LOG)"
    : null;

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

(skipReason === null ? describe : describe.skip)(`pi system prompt combination, real data${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  it("rebuilds every sidecar-covered session's prompt to the logger's exact size, with parts summing to it", async () => {
    const index = await readSystemPromptSidecarIndex(logPath);
    const coverage: number[] = [];
    let files = 0;
    let branchesWithBoth = 0;
    let withExtensionPart = 0;
    const failures: string[] = [];

    for (const filePath of listPiAgentSessionFiles(sessionsDir)) {
      files += 1;
      const records = index.get(path.resolve(filePath));
      if (!records) continue;
      const { entries } = await readPiSessionFile(filePath);
      for (const leafId of findLeafEntryIds(entries)) {
        const branch = walkBranch(entries, leafId);
        const state = replaySystemMessages(branch);
        const record = selectSidecarRecord(records, branchEndTimestamp(branch));
        if (!state || !record) continue;
        branchesWithBoth += 1;

        const resolved = resolvePiSystemPrompt(branch, records);
        const combined = buildCombinedSystemPrompt(state, record);
        const partsTotal = combined.parts.reduce((sum, part) => sum + part.text.length, 0);
        const label = `file#${files} leaf#${leafId.slice(0, 6)}`;
        if (resolved.text?.length !== record.systemPromptChars) failures.push(`${label}: text length ${resolved.text?.length} != systemPromptChars ${record.systemPromptChars}`);
        if (partsTotal !== record.systemPromptChars) failures.push(`${label}: parts sum ${partsTotal} != ${record.systemPromptChars}`);
        if (resolved.note !== undefined) failures.push(`${label}: unexpected in-file note`);

        const ownChars = combined.parts.reduce((sum, part) => sum + (part.ownChars ?? 0), 0);
        coverage.push(record.systemPromptChars === 0 ? 1 : ownChars / record.systemPromptChars);
        if (combined.parts.some((part) => part.ownChars === undefined)) withExtensionPart += 1;
      }
    }

    console.log(
      [
        "pi system prompt real-data summary",
        `  session files scanned: ${files}; sidecar records files: ${index.size}`,
        `  branches with both sources: ${branchesWithBoth}`,
        `  pi-section coverage of the exact prompt: min ${pct(Math.min(...coverage))}, median ${pct(median(coverage))}`,
        `  branches with an "Added by pi extensions" part: ${withExtensionPart}`,
        `  mismatches: ${failures.length}`,
      ].join("\n"),
    );
    expect(failures).toEqual([]);
    expect(branchesWithBoth).toBeGreaterThan(0);
  }, 300_000);
});
