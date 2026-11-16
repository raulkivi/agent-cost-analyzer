// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TurnUsage } from "@agent-cost-analyzer/domain";
import { ClaudeCodeRunTranscriptCache } from "./claude-code-run-cache.js";
import { readClaudeCodeSessionFile } from "./claude-code-jsonl-reader.js";
import { foldClaudeCodeSubagentUsage } from "./session-subagent-usage.js";
import { SUBAGENT_COUNTED_ELSEWHERE_NOTE, SUBAGENT_TOO_MANY_REASON } from "./subagent-attribution.js";
import { branchOf } from "./subagent-case-loader.js";
import { copySubagentFixtureCase, makeSubagentCapFolder } from "./subagent-fixture-builders.js";
import { MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION } from "./subagent-transcript-path.js";
import { extractTurnUsage } from "./usage-extractor.js";

const tempDirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "session-subagents-"));
  tempDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fold(sessionFile: string, siblings: string[] = []) {
  const sessionEntries = (await readClaudeCodeSessionFile(sessionFile)).entries;
  const { branch, turnGroups } = branchOf(sessionEntries);
  const turnUsages = turnGroups.map(extractTurnUsage);
  const result = await foldClaudeCodeSubagentUsage(
    { sessionFilePath: sessionFile, siblingSessionFilePaths: siblings, sessionEntries, branch, turnGroups, turnUsages },
    new ClaudeCodeRunTranscriptCache(),
  );
  return { turnUsages, ...result };
}

const outputOf = (usage: Pick<TurnUsage, "output">) => (usage.output.known ? usage.output.value : null);

describe("foldClaudeCodeSubagentUsage", () => {
  it("leaves a session without subagent folders as it is", async () => {
    const copy = copySubagentFixtureCase("failed-launch", tempDir());

    const { turnUsages, usages, sessionUnknownReasons } = await fold(copy.sessionFile);

    expect(usages).toEqual(turnUsages);
    expect(sessionUnknownReasons).toEqual([]);
  });

  it("adds a linked run to the turn that started it and keeps the main agent's own figures", async () => {
    const copy = copySubagentFixtureCase("linked-run", tempDir());

    const { turnUsages, usages, sessionUnknownReasons } = await fold(copy.sessionFile);

    const folded = usages.find((usage) => usage.subagents !== undefined && usage.subagents.length > 0);
    expect(folded?.subagents).toHaveLength(1);
    expect(outputOf(folded!)).toBeGreaterThan(outputOf(folded!.ownUsage!)!);
    expect(usages.reduce((sum, usage) => sum + (outputOf(usage) ?? 0), 0)).toBeGreaterThan(
      turnUsages.reduce((sum, usage) => sum + (outputOf(usage) ?? 0), 0),
    );
    expect(sessionUnknownReasons).toEqual([]);
  });

  it("does not count a run whose call is off the active branch, and names it for the oracle", async () => {
    const copy = copySubagentFixtureCase("off-branch-call", tempDir());

    const { turnUsages, usages, offBranchRunIds } = await fold(copy.sessionFile);

    expect(offBranchRunIds).toHaveLength(1);
    expect(usages.map(outputOf)).toEqual(turnUsages.map(outputOf));
  });

  it("makes the session's totals unknown, with the reason, when a folder is over the file cap", async () => {
    const copy = makeSubagentCapFolder(tempDir(), MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION + 1);

    const { usages, sessionUnknownReasons } = await fold(copy.sessionFile);

    expect(sessionUnknownReasons).toContain(SUBAGENT_TOO_MANY_REASON);
    const total = usages.reduce((sum, usage) => (usage.output.known && sum !== null ? sum + usage.output.value : null), 0 as number | null);
    expect(total).toBeNull();
    const unknown = usages.find((usage) => !usage.output.known);
    expect(unknown?.output).toEqual({ known: false, reason: expect.stringContaining(SUBAGENT_TOO_MANY_REASON) });
    expect(unknown?.ownUsage?.output.known).toBe(true);
  });

  it("counts a run another session's folder holds in that session only (D7)", async () => {
    const root = tempDir();
    const copy = copySubagentFixtureCase("linked-run", root);
    const otherId = "d4d4d4d4-0002-4000-8000-000000000002";
    const otherSubagents = path.join(copy.projectDir, otherId, "subagents");
    mkdirSync(otherSubagents, { recursive: true });
    for (const name of readdirSync(copy.subagentsDir).filter((entry) => /^agent-[A-Za-z0-9]+\.(meta\.json|jsonl)$/.test(entry))) {
      renameSync(path.join(copy.subagentsDir, name), path.join(otherSubagents, name));
    }
    const otherFile = path.join(copy.projectDir, `${otherId}.jsonl`);
    writeFileSync(otherFile, `${JSON.stringify({ type: "user", uuid: "o1", parentUuid: null, message: { role: "user", content: "x" } })}\n`);

    const withSibling = await fold(copy.sessionFile, [otherFile]);
    const without = await fold(copy.sessionFile);

    expect(withSibling.usages.every((usage) => (usage.subagents ?? []).length === 0)).toBe(true);
    expect(withSibling.notesByTurn.size).toBe(1);
    expect([...withSibling.notesByTurn.values()][0]).toContain(SUBAGENT_COUNTED_ELSEWHERE_NOTE);
    expect(withSibling.sessionUnknownReasons).toEqual([]);
    expect(withSibling.usages.every((usage) => usage.output.known)).toBe(true);
    // Without the sibling the run is simply missing: the turn is unknown.
    expect(without.usages.some((usage) => !usage.output.known)).toBe(true);
  });
});
