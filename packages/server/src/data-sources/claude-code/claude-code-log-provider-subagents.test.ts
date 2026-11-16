// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Session, TokenCount } from "@agent-cost-analyzer/domain";
import { ClaudeCodeLogProvider } from "./claude-code-log-provider.js";
import { ClaudeCodeRunTranscriptCache } from "./claude-code-run-cache.js";
import { copySubagentFixtureCase, makeSubagentCapFolder } from "./subagent-fixture-builders.js";
import { MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION } from "./subagent-transcript-path.js";
import { readSubagentTranscript } from "./subagent-transcript-reader.js";

const tempDirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cc-subagent-provider-"));
  tempDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const knownValue = (count: TokenCount): number | null => (count.known ? count.value : null);
const outputTotal = (session: Session): number | null =>
  session.turns.reduce<number | null>((sum, turn) => {
    const value = knownValue(turn.usage.output);
    return sum === null || value === null ? null : sum + value;
  }, 0);

describe("ClaudeCodeLogProvider with subagent runs", () => {
  it("counts a run in the session detail and keeps the list's summary equal to it", async () => {
    const root = tempDir();
    copySubagentFixtureCase("linked-run", root);
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: root });

    const [summary] = await provider.listSessions();
    const detail = (await provider.readSession(summary!.id))!;

    expect(summary).toMatchObject({
      id: detail.id,
      turnCount: detail.turnCount,
      model: detail.model,
      usageDataAvailable: detail.usageDataAvailable,
    });
    expect(summary!.costAiCredits).toEqual(detail.costAiCredits);
    // Own output is 80 + 40 tokens; the run adds its own rounds on top.
    const counted = detail.turns.find((turn) => (turn.usage.subagents ?? []).length > 0);
    expect(counted?.usage.subagents).toHaveLength(1);
    expect(outputTotal(detail)).toBeGreaterThan(120);
    expect(counted?.usage.ownUsage?.output).toEqual({ known: true, value: 120 });
  });

  it("gives the same turns from a list and a detail built in either order", async () => {
    const root = tempDir();
    copySubagentFixtureCase("nested-run", root);

    const first = new ClaudeCodeLogProvider({ projectsDirPath: root });
    const detailFirst = (await first.readSession((await first.listSessions())[0]!.id))!;
    const second = new ClaudeCodeLogProvider({ projectsDirPath: root });
    const listAfter = await second.listSessions();
    const detailAfter = (await second.readSession(listAfter[0]!.id))!;

    expect(detailAfter.turns).toEqual(detailFirst.turns);
    expect(listAfter[0]).toMatchObject({ turnCount: detailAfter.turnCount, usageDataAvailable: detailAfter.usageDataAvailable });
  });

  it("makes the session's tokens unknown, with the reason, when it has too many subagent transcripts", async () => {
    const copy = makeSubagentCapFolder(tempDir(), MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION + 1);
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: copy.projectsDir });

    const [summary] = await provider.listSessions();
    const detail = (await provider.readSession(summary!.id))!;

    expect(outputTotal(detail)).toBeNull();
    expect(detail.turns.map((turn) => turn.usage.output).find((output) => !output.known)).toMatchObject({
      reason: expect.stringContaining("too many subagent transcripts"),
    });
  });

  it("does not read an unchanged transcript again on the next list or detail", async () => {
    const root = tempDir();
    copySubagentFixtureCase("linked-run", root);
    const reads: string[] = [];
    const runCache = new ClaudeCodeRunTranscriptCache({
      read: async (file) => {
        reads.push(file);
        return readSubagentTranscript(file);
      },
    });
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: root, runCache });

    const [summary] = await provider.listSessions();
    await provider.readSession(summary!.id);
    await provider.listSessions();

    expect(reads).toHaveLength(1);
  });

  describe("budget", () => {
    // Plan D16: a project holds about 2.5 times its session files' bytes in
    // transcripts. This is a session with that ratio: the cold list streams
    // it inside the time budget, and the warm list reads no transcript.
    const RUNS = 10;
    const COLD_BUDGET_MS = 3000;
    const pad = (bytes: number) => "x".repeat(bytes);
    const usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 20, output_tokens: 5 };
    const lines = (items: unknown[]) => `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;

    function writeBudgetSession(root: string) {
      const sessionId = "b0b0b0b0-0001-4000-8000-000000000001";
      const projectDir = path.join(root, "-home-dev-project");
      const subagentsDir = path.join(projectDir, sessionId, "subagents");
      mkdirSync(subagentsDir, { recursive: true });
      const base = { isSidechain: false, userType: "external", cwd: "/home/dev/project", sessionId, version: "2.1.320" };
      const session: unknown[] = [
        { ...base, parentUuid: null, type: "user", message: { role: "user", content: "Made-up request." }, uuid: "u1", timestamp: "2026-10-01T10:00:00.000Z" },
      ];
      let parent = "u1";
      for (let i = 0; i < RUNS; i += 1) {
        const agentId = `a${i.toString(16).padStart(16, "0")}`;
        const callId = `toolu_budget_${i}`;
        session.push({
          ...base,
          parentUuid: parent,
          type: "assistant",
          message: { model: "claude-sonnet-5-5", id: `msg_s${i}`, role: "assistant", content: [{ type: "tool_use", id: callId, name: "Agent", input: { prompt: pad(8_000) } }], usage },
          requestId: `req_s${i}`,
          uuid: `s${i}`,
          timestamp: "2026-10-01T10:00:02.000Z",
        });
        session.push({
          ...base,
          parentUuid: `s${i}`,
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: callId, content: pad(8_000) }] },
          uuid: `r${i}`,
          timestamp: "2026-10-01T10:00:03.000Z",
          toolUseResult: { status: "async_launched", agentId },
        });
        parent = `r${i}`;
        writeFileSync(path.join(subagentsDir, `agent-${agentId}.meta.json`), JSON.stringify({ toolUseId: callId, agentType: "general-purpose", spawnDepth: 1 }));
      }
      writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), lines(session));
      return { projectDir, sessionFile: path.join(projectDir, `${sessionId}.jsonl`), subagentsDir };
    }

    function writeRuns(subagentsDir: string, sessionBytes: number) {
      const perRun = Math.ceil((sessionBytes * 2.5) / RUNS);
      const roundBytes = 2_000;
      for (let i = 0; i < RUNS; i += 1) {
        const agentId = `a${i.toString(16).padStart(16, "0")}`;
        const items: unknown[] = [];
        for (let round = 0; round * (roundBytes + 450) < perRun * 1.1; round += 1) {
          items.push({
            isSidechain: true,
            agentId,
            type: "assistant",
            message: { model: "claude-sonnet-5-5", id: `msg_${i}_${round}`, role: "assistant", content: [{ type: "text", text: pad(roundBytes) }], usage },
            requestId: `req_${i}_${round}`,
            uuid: `a${i}-${round}`,
            timestamp: "2026-10-01T10:00:05.000Z",
          });
        }
        writeFileSync(path.join(subagentsDir, `agent-${agentId}.jsonl`), lines(items));
      }
    }

    it("lists a session whose transcripts hold 2.5 times its bytes inside the budget, then reads none", async () => {
      const root = tempDir();
      const { sessionFile, subagentsDir } = writeBudgetSession(root);
      const sessionBytes = statSync(sessionFile).size;
      writeRuns(subagentsDir, sessionBytes);
      const runBytes = Array.from({ length: RUNS }, (_, i) => statSync(path.join(subagentsDir, `agent-a${i.toString(16).padStart(16, "0")}.jsonl`)).size).reduce((a, b) => a + b, 0);
      expect(runBytes / sessionBytes).toBeGreaterThanOrEqual(2.5);

      const reads: string[] = [];
      const runCache = new ClaudeCodeRunTranscriptCache({
        read: async (file) => {
          reads.push(file);
          return readSubagentTranscript(file);
        },
      });
      const provider = new ClaudeCodeLogProvider({ projectsDirPath: root, runCache });

      const coldStart = performance.now();
      const [summary] = await provider.listSessions();
      const cold = performance.now() - coldStart;
      const warmStart = performance.now();
      const detail = (await provider.readSession(summary!.id))!;
      const warm = performance.now() - warmStart;

      expect(cold).toBeLessThan(COLD_BUDGET_MS);
      expect(reads).toHaveLength(RUNS);
      expect(detail.turns[0]!.usage.subagents).toHaveLength(RUNS);
      expect(warm).toBeLessThan(COLD_BUDGET_MS);
      console.info(`Claude Code list, runs at ${(runBytes / sessionBytes).toFixed(1)}x session bytes: cold ${cold.toFixed(0)} ms (budget ${COLD_BUDGET_MS} ms), warm ${warm.toFixed(0)} ms`);
    });
  });
});
