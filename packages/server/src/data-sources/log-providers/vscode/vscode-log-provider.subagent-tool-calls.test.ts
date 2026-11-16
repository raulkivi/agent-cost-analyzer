// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sessionSchema } from "@agent-cost-analyzer/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedSubagentAuditFixtureSession } from "../../../test-support/copilot-session-store.js";
import * as spans from "../../jsonl/tool-call-spans.js";
import { missingSubagentLogReason, UNLOGGED_SUBAGENT_TOOL_REASON } from "../../jsonl/subagent-tool-call-reasons.js";
import { VscodeLogProvider } from "./vscode-log-provider.js";

// Step 10.20 ST7: a classic session's detail lists the tool calls of the
// subagent runs its turns started, each with an origin; the list path reads
// no child file for the audit.
describe("VscodeLogProvider: classic subagent tool calls", () => {
  let dir: string;
  let dbPath: string;
  let debugLogsDir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vscode-log-provider-subagent-calls-"));
    dbPath = path.join(dir, "session-store.db");
    debugLogsDir = path.join(dir, "debug-logs");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const provider = () => new VscodeLogProvider({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDir], agentTracesDbPath: null });

  it("lists the main agent's calls first, then the run's, each run call with its origin", async () => {
    seedSubagentAuditFixtureSession(dbPath, debugLogsDir, "shared-span-id");

    const detail = await provider().readSession("shared-span-id");

    const calls = detail!.turns[0].toolCalls;
    expect(calls.map((call) => [call.name, call.origin?.kind ?? "main"])).toEqual([
      ["runSubagent", "main"],
      ["read_file", "main"],
      ["grep_search", "subagent"],
    ]);
    expect(calls[0].kind).toBe("subagent");
    expect(calls[2].origin).toEqual({
      kind: "subagent",
      runId: "call_auditshared1",
      label: "runSubagent-Explore",
      depth: 1,
      startedByCallId: "span-tool-run",
    });
    expect(sessionSchema.safeParse(detail).success).toBe(true);
  });

  it("counts a call id once: the parent's read_file, not the run's copy", async () => {
    seedSubagentAuditFixtureSession(dbPath, debugLogsDir, "shared-span-id");

    const detail = await provider().readSession("shared-span-id");

    const ids = detail!.turns.flatMap((turn) => turn.toolCalls.map((call) => call.id));
    expect(ids.filter((id) => id === "span-shared-read")).toHaveLength(1);
    expect(detail!.turns[0].toolCalls.find((call) => call.id === "span-shared-read")?.origin).toBeUndefined();
  });

  it("a missing child log is a gap on the turn that started the run", async () => {
    seedSubagentAuditFixtureSession(dbPath, debugLogsDir, "missing-log");

    const detail = await provider().readSession("missing-log");

    expect(detail!.turns[0].subagentRunGaps).toEqual([
      {
        runId: "call_auditmissing1",
        label: "runSubagent-Explore",
        depth: 1,
        reason: missingSubagentLogReason("runSubagent-Explore"),
      },
    ]);
    expect(detail!.turns[0].toolCalls.map((call) => call.origin?.kind ?? "main")).toEqual(["main"]);
    expect(sessionSchema.safeParse(detail).success).toBe(true);
  });

  it("explore_subagent: the linked call's run is listed, the one without a log is a gap", async () => {
    seedSubagentAuditFixtureSession(dbPath, debugLogsDir, "explore-linked");

    const detail = await provider().readSession("explore-linked");

    const calls = detail!.turns[0].toolCalls;
    expect(calls.filter((call) => call.origin?.kind === "subagent")).toHaveLength(3);
    expect(calls.filter((call) => call.kind === "subagent").map((call) => call.id)).toEqual(["span-explore-1", "span-explore-2"]);
    expect(detail!.turns[0].subagentRunGaps).toEqual([
      { runId: "span-explore-2", label: "searchSubagent", depth: 1, reason: UNLOGGED_SUBAGENT_TOOL_REASON },
    ]);
  });

  it("lists the runs it read in full on the turn, and none it could not read", async () => {
    seedSubagentAuditFixtureSession(dbPath, debugLogsDir, "shared-span-id");
    seedSubagentAuditFixtureSession(dbPath, debugLogsDir, "missing-log");

    const read = await provider().readSession("shared-span-id");
    const missing = await provider().readSession("missing-log");

    expect(read!.turns[0].subagentRunsRead).toEqual(["call_auditshared1"]);
    expect(missing!.turns[0].subagentRunsRead).toBeUndefined();
  });

  it("lists a run linked to its call by the call's time window as placed by time, not one linked by its span", async () => {
    seedSubagentAuditFixtureSession(dbPath, debugLogsDir, "explore-linked");
    seedSubagentAuditFixtureSession(dbPath, debugLogsDir, "shared-span-id");

    const explore = await provider().readSession("explore-linked");
    const linked = await provider().readSession("shared-span-id");

    expect(explore!.turns[0].subagentRunsByTime).toHaveLength(1);
    expect(linked!.turns[0].subagentRunsByTime).toBeUndefined();
    expect(sessionSchema.safeParse(explore).success).toBe(true);
  });

  it("a session with no run has no gaps and no origin", async () => {
    seedSubagentAuditFixtureSession(dbPath, debugLogsDir, "missing-log");
    const detail = await provider().readSession("missing-log");

    expect(detail!.turns.every((turn) => turn.toolCalls.every((call) => call.origin === undefined))).toBe(true);
  });

  it("the list path reads no span and no child file for the audit", async () => {
    seedSubagentAuditFixtureSession(dbPath, debugLogsDir, "shared-span-id");
    const byTurn = vi.spyOn(spans, "readToolCallRecordsByLogTurn");
    const flat = vi.spyOn(spans, "readToolCallRecords");

    const listed = await provider().listSessions();

    expect(listed.map((session) => session.id)).toContain("shared-span-id");
    expect(byTurn).not.toHaveBeenCalled();
    expect(flat).not.toHaveBeenCalled();

    // The spies see the detail read, so the list's silence is a result.
    await provider().readSession("shared-span-id");
    expect(byTurn).toHaveBeenCalled();
    expect(flat).toHaveBeenCalled();
  });
});
