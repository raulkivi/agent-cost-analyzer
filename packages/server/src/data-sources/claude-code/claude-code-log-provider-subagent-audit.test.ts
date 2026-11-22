// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionAuditSchema, turnSchema, type Session, type ToolCallRecord } from "@agent-cost-analyzer/domain";
import { buildSessionAudit } from "../../services/tool-audit/session-audit-builder.js";
import { providerSessions } from "../../test-support/insights-fakes.js";
import { buildInsightRows } from "../../services/insights/insights-dataset-builder.js";
import { DEFAULT_SECURITY_RULES } from "../../services/insights/security-rules.js";
import { SecurityScanner } from "../../services/insights/security-scanner.js";
import { ClaudeCodeLogProvider } from "./claude-code-log-provider.js";
import { ClaudeCodeRunTranscriptCache } from "./claude-code-run-cache.js";
import { computeClaudeCodeFileHash } from "./session-id.js";
import { copySubagentFixtureCase, makeSymlinkedSubagentTranscript } from "./subagent-fixture-builders.js";
import { MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION } from "./subagent-transcript-path.js";

// CS14 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/claude-code-subagents.md D9, section 6): the tool calls of
// the subagent runs a Claude Code session started reach the audit and the
// security findings, on the detail read only.
const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/claude-code/subagents");

const tempDirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cc-subagent-audit-"));
  tempDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// `sessionFile` picks the session when the folder holds other .jsonl files (a symlink's target).
async function detailOf(projectsDir: string, sessionFile?: string): Promise<Session> {
  const provider = new ClaudeCodeLogProvider({ projectsDirPath: projectsDir });
  if (sessionFile !== undefined) return (await provider.readSession(computeClaudeCodeFileHash(sessionFile)))!;
  const [summary] = await provider.listSessions();
  return (await provider.readSession(summary!.id))!;
}

async function detailOfCase(caseName: string): Promise<Session> {
  const root = tempDir();
  copySubagentFixtureCase(caseName, root);
  return detailOf(root);
}

const allCalls = (session: Session): ToolCallRecord[] => session.turns.flatMap((turn) => turn.toolCalls);
const subagentCalls = (session: Session): ToolCallRecord[] => allCalls(session).filter((call) => call.origin?.kind === "subagent");
const gapsOf = (session: Session) => session.turns.flatMap((turn) => turn.subagentRunGaps ?? []);
const readOf = (session: Session) => session.turns.flatMap((turn) => turn.subagentRunsRead ?? []);

describe("Claude Code subagent tool calls in the detail read", () => {
  it("lists a run's calls after the main agent's, each with the run as origin", async () => {
    const session = await detailOfCase("linked-run");

    const calls = session.turns.find((turn) => turn.subagentRunsRead !== undefined)!.toolCalls;
    expect(calls.map((call) => [call.name, call.origin?.kind ?? "main"])).toEqual([
      ["Agent", "main"],
      ["Read", "subagent"],
    ]);
    expect(calls[0]!.kind).toBe("subagent");
    expect(calls[1]!.origin).toEqual({
      kind: "subagent",
      runId: "a111111111111111a",
      label: "Agent-general-purpose",
      depth: 1,
      startedByCallId: "toolu_lr_call",
    });
    expect(calls[1]!.outcome?.status).toBe("success");
    expect(readOf(session)).toEqual(["a111111111111111a"]);
    expect(gapsOf(session)).toEqual([]);
  });

  it("keeps the run's id equal to the cost side's, so the audit and the cost views link one run", async () => {
    const session = await detailOfCase("linked-run");

    const turn = session.turns.find((candidate) => candidate.usage.subagents?.length)!;
    expect(turn.usage.subagents!.map((run) => run.id)).toEqual(["a111111111111111a"]);
    expect(subagentCalls(session).map((call) => (call.origin?.kind === "subagent" ? call.origin.runId : undefined))).toEqual([
      "a111111111111111a",
    ]);
  });

  it("does not read a transcript's tool content on the list path", async () => {
    const root = tempDir();
    const copy = copySubagentFixtureCase("linked-run", root);
    const cache = new ClaudeCodeRunTranscriptCache();
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: root, runCache: cache });

    const [summary] = await provider.listSessions();
    expect(summary!.turns).toEqual([]);
    const loaded = await cache.load(path.join(copy.subagentsDir, "agent-a111111111111111a.jsonl"));
    // The run-summary cache keeps its allow-list: no tool input or output.
    expect(JSON.stringify(loaded)).not.toMatch(/tool_use|tool_result|made-up\.ts|made-up file content/);
  });

  it("reads the audit once per detail read and never for the list", async () => {
    const root = tempDir();
    copySubagentFixtureCase("linked-run", root);
    const subagentAudit = vi.fn(async () => ({ callsByTurn: [], gapsByTurn: [], readRunIdsByTurn: [], byTimeRunIdsByTurn: [] }));
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: root, subagentAudit });

    const [summary] = await provider.listSessions();
    expect(subagentAudit).not.toHaveBeenCalled();
    await provider.readSession(summary!.id);
    expect(subagentAudit).toHaveBeenCalledTimes(1);
  });

  it("gives every run a depth, its parent and the call that started it (nested run)", async () => {
    const root = tempDir();
    const copy = copySubagentFixtureCase("nested-run", root);
    // The inner run B makes one call of its own.
    appendFileSync(
      path.join(copy.subagentsDir, "agent-a222222222222222b.jsonl"),
      `${JSON.stringify({
        parentUuid: null,
        isSidechain: true,
        agentId: "a222222222222222b",
        type: "assistant",
        message: {
          id: "msg_inner_tool",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [{ type: "tool_use", id: "toolu_inner", name: "Bash", input: { command: "ls" } }],
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        requestId: "req_inner",
        uuid: "inner-1",
        timestamp: "2026-10-02T10:00:30.000Z",
      })}\n`,
    );

    const session = await detailOf(root);

    const inner = subagentCalls(session).find((call) => call.id === "toolu_inner")!;
    expect(inner.origin).toMatchObject({
      kind: "subagent",
      runId: "a222222222222222b",
      depth: 2,
      parentRunId: "a211111111111111a",
    });
    const outer = subagentCalls(session).find((call) => call.name === "Agent")!;
    expect(outer.origin).toMatchObject({ runId: "a211111111111111a", depth: 1 });
    expect(outer.origin).not.toHaveProperty("parentRunId");
    expect([...readOf(session)].sort()).toEqual(["a211111111111111a", "a222222222222222b"]);
  });

  describe("fork copies (CS D4)", () => {
    it("skips the tool-use ids a fork copied from the parent and keeps the fork's own", async () => {
      const session = await detailOfCase("tool-audit-fork");

      expect(allCalls(session).map((call) => [call.id, call.origin?.kind ?? "main"])).toEqual([
        ["toolu_ta_main", "main"],
        ["toolu_ta_agent", "main"],
        ["toolu_ta_run_bash", "subagent"],
        ["toolu_ta_run_read", "subagent"],
      ]);
      expect(readOf(session)).toEqual(["ad11111111111111a"]);
    });

    it("skips a nested fork's copy of its parent run's call, counted once in the outer run", async () => {
      const session = await detailOfCase("nested-fork-copy");

      const ids = allCalls(session).map((call) => call.id);
      expect(ids.filter((id) => id === "toolu_nf_call")).toHaveLength(1);
      const copied = subagentCalls(session).find((call) => call.id === "toolu_nf_call")!;
      expect(copied.origin).toMatchObject({ runId: "a411111111111111a", depth: 1 });
      // The inner run was read in full and made no call of its own.
      expect(readOf(session)).toContain("a422222222222222b");
    });

    it("counts no (session, call id) twice in any fixture case", async () => {
      for (const name of readdirSync(fixturesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
        const session = await detailOfCase(name);
        const ids = allCalls(session).flatMap((call) => (call.id === undefined ? [] : [call.id]));
        expect(new Set(ids).size, name).toBe(ids.length);
      }
    });
  });

  describe("unread rules (CS section 6)", () => {
    it("makes a run unknown when its meta is there and its transcript is missing", async () => {
      const session = await detailOfCase("missing-transcript");

      expect(subagentCalls(session)).toEqual([]);
      expect(gapsOf(session)).toHaveLength(1);
      expect(gapsOf(session)[0]).toMatchObject({ label: "Agent-general-purpose", depth: 1 });
      expect(gapsOf(session)[0]!.reason).toMatch(/transcript.*missing.*tool calls are unknown/);
      expect(readOf(session)).toEqual([]);
    });

    it("leaves a failed launch with no run and no gap", async () => {
      const session = await detailOfCase("failed-launch");

      expect(gapsOf(session)).toEqual([]);
      expect(readOf(session)).toEqual([]);
      expect(subagentCalls(session)).toEqual([]);
    });

    it("does not count a run whose Agent call is off the active branch", async () => {
      const session = await detailOfCase("off-branch-call");

      expect(subagentCalls(session)).toEqual([]);
      expect(gapsOf(session)).toEqual([]);
      expect(readOf(session)).toEqual([]);
    });

    it("makes a symlinked transcript unknown as not a regular file", async () => {
      const root = tempDir();
      const copy = copySubagentFixtureCase("tool-audit-fork", root);
      makeSymlinkedSubagentTranscript(copy, root);

      const session = await detailOf(root, copy.sessionFile);

      expect(subagentCalls(session)).toEqual([]);
      expect(gapsOf(session)[0]!.reason).toMatch(/not a regular file/);
      expect(readOf(session)).toEqual([]);
    });

    it("makes a transcript with no parsable line unknown as unreadable", async () => {
      const root = tempDir();
      const copy = copySubagentFixtureCase("tool-audit-fork", root);
      writeFileSync(path.join(copy.subagentsDir, "agent-ad11111111111111a.jsonl"), "not json\n{broken\n");

      const session = await detailOf(root);

      expect(subagentCalls(session)).toEqual([]);
      expect(gapsOf(session)).toHaveLength(1);
      expect(gapsOf(session)[0]!.reason).toMatch(/could not be read.*tool calls of the run/);
    });

    it("skips a partial last line of a live run and keeps the complete calls", async () => {
      const root = tempDir();
      const copy = copySubagentFixtureCase("tool-audit-fork", root);
      appendFileSync(
        path.join(copy.subagentsDir, "agent-ad11111111111111a.jsonl"),
        '{"type":"assistant","message":{"id":"msg_cut","content":[{"type":"tool_use","id":"toolu_cut","name":"Bash","inp',
      );

      const session = await detailOf(root);

      expect(subagentCalls(session).map((call) => call.id)).toEqual(["toolu_ta_run_bash", "toolu_ta_run_read"]);
      expect(readOf(session)).toEqual(["ad11111111111111a"]);
    });

    it("still lists the calls of a run whose round misses a numeric usage field", async () => {
      const root = tempDir();
      const copy = copySubagentFixtureCase("tool-audit-fork", root);
      const file = path.join(copy.subagentsDir, "agent-ad11111111111111a.jsonl");
      writeFileSync(file, readFileSync(file, "utf8").replaceAll('"output_tokens":20,', ""));

      const session = await detailOf(root);

      expect(subagentCalls(session).map((call) => call.id)).toEqual(["toolu_ta_run_bash", "toolu_ta_run_read"]);
      expect(gapsOf(session)).toEqual([]);
    });

    it("ignores a name outside the pattern: no run, no gap, no call", async () => {
      const root = tempDir();
      const copy = copySubagentFixtureCase("tool-audit-fork", root);
      writeFileSync(path.join(copy.subagentsDir, "agent-..%2Fevil.jsonl"), '{"type":"assistant"}\n');
      writeFileSync(path.join(copy.subagentsDir, "agent-ad11111111111111a.forked-skill.json"), "{}\n");

      const session = await detailOf(root);

      expect(subagentCalls(session)).toHaveLength(2);
      expect(gapsOf(session)).toEqual([]);
    });

    it("makes every run unknown when the folder holds too many transcripts", async () => {
      const root = tempDir();
      const copy = copySubagentFixtureCase("tool-audit-fork", root);
      for (let i = 0; i <= MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION; i += 1) {
        writeFileSync(path.join(copy.subagentsDir, `agent-a${i.toString(16).padStart(16, "0")}.jsonl`), '{"type":"user"}\n');
      }

      const session = await detailOf(root);

      expect(subagentCalls(session)).toEqual([]);
      expect(gapsOf(session)).toHaveLength(1);
      expect(gapsOf(session)[0]!.reason).toMatch(/too many subagent transcripts/);
    });

    it("makes a symlinked subagents folder unknown, reading nothing through it", async () => {
      const root = tempDir();
      const copy = copySubagentFixtureCase("tool-audit-fork", root);
      const outside = path.join(root, "outside");
      mkdirSync(outside);
      for (const name of readdirSync(copy.subagentsDir)) writeFileSync(path.join(outside, name), readFileSync(path.join(copy.subagentsDir, name)));
      rmSync(copy.subagentsDir, { recursive: true });
      symlinkSync(outside, copy.subagentsDir);

      const session = await detailOf(root, copy.sessionFile);

      expect(subagentCalls(session)).toEqual([]);
      expect(gapsOf(session)[0]!.reason).toMatch(/not a regular folder/);
    });

    it("lists the calls of a run matched by time like any other run", async () => {
      const session = await detailOfCase("unlinked-transcript");

      expect(readOf(session)).toEqual(["a711111111111111a"]);
      expect(gapsOf(session)).toEqual([]);
    });

    it("marks a run matched by time, and the audit row says so; a linked run is not marked", async () => {
      const byTime = await detailOfCase("unlinked-transcript");
      const linked = await detailOfCase("linked-run");

      expect(byTime.turns.flatMap((turn) => turn.subagentRunsByTime ?? [])).toEqual(["a711111111111111a"]);
      expect(buildSessionAudit(byTime).subagentRuns?.[0]?.matchedByTime).toBe(true);
      expect(linked.turns.flatMap((turn) => turn.subagentRunsByTime ?? [])).toEqual([]);
      expect(buildSessionAudit(linked).subagentRuns?.[0]?.matchedByTime).toBeUndefined();
    });
  });

  describe("reaching the audit and the security findings", () => {
    it("counts the run's calls in the session audit, split by origin", async () => {
      const session = await detailOfCase("tool-audit-fork");

      const audit = sessionAuditSchema.parse(buildSessionAudit(session));

      expect(audit.totals.toolCalls).toBe(4);
      expect(audit.byOrigin!.subagents.toolCalls).toBe(2);
      expect(audit.byOrigin!.subagents.runs).toBe(1);
      expect(audit.byOrigin!.main.toolCalls).toBe(2);
      expect(audit.subagentRuns).toHaveLength(1);
      expect(audit.subagentRuns![0]).toMatchObject({ runId: "ad11111111111111a", label: "Agent-general-purpose", depth: 1 });
      expect(audit.subagentRuns![0]!.totals).not.toBeNull();
    });

    it("shows an unread run as unknown in the audit, never as 0 calls", async () => {
      const session = await detailOfCase("missing-transcript");

      const audit = buildSessionAudit(session);

      expect(audit.subagentRuns).toHaveLength(1);
      expect(audit.subagentRuns![0]!.totals).toBeNull();
      expect(audit.subagentRuns![0]!.unreadReason).toMatch(/tool calls are unknown/);
    });

    it("scans the run's calls for security findings and names the run on each", async () => {
      const session = await detailOfCase("tool-audit-fork");
      const sources = [providerSessions([session], "claude-code")];

      const findings = new SecurityScanner(DEFAULT_SECURITY_RULES).detect({ sources, rows: buildInsightRows(sources) });

      expect(findings.map((finding) => [finding.ruleId, finding.origin?.kind])).toEqual([["shell.pipe-to-shell", "subagent"]]);
      expect(findings[0]!.origin).toMatchObject({ runId: "ad11111111111111a", label: "Agent-general-purpose" });
    });

    it("produces turns the domain schema accepts", async () => {
      const session = await detailOfCase("tool-audit-fork");

      for (const turn of session.turns) expect(() => turnSchema.parse(turn)).not.toThrow();
    });

    it("keeps the Agent call's prompt out of every call the audit lists", async () => {
      const session = await detailOfCase("tool-audit-fork");

      const agentCall = allCalls(session).find((call) => call.name === "Agent")!;
      expect(agentCall.kind).toBe("subagent");
      // The MCP layer blanks argsSummary for this kind (publicAuditedCall).
      expect(JSON.stringify(subagentCalls(session))).not.toContain("Do the made-up task");
    });
  });
});
