// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_ARGS_SUMMARY_LENGTH } from "../../../services/tool-audit/args-summary.js";
import { seedCopilotSessionStore, USAGE_LOG_USER_MESSAGE, USAGE_SESSION_ID } from "../../../test-support/copilot-session-store.js";
import { VscodeLogProvider } from "./vscode-log-provider.js";

// Step 10.20 ST6 (D3): a classic session's own tool calls come from the debug
// log's tool_call spans, with outcome, duration and a bounded argument summary.
describe("VscodeLogProvider: classic tool calls from debug-log spans", () => {
  let dir: string;
  let dbPath: string;
  let debugLogsDir: string;

  const line = (type: string, spanId: string, extra: Record<string, unknown>) =>
    JSON.stringify({ v: 1, ts: 1_791_000_000_000, dur: 0, sid: USAGE_SESSION_ID, type, name: type, spanId, status: "ok", ...extra });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vscode-log-provider-tool-calls-"));
    dbPath = path.join(dir, "session-store.db");
    debugLogsDir = path.join(dir, "debug-logs");
    seedCopilotSessionStore(dbPath, "2026-09-21T10:00:00.000Z");
    mkdirSync(path.join(debugLogsDir, USAGE_SESSION_ID), { recursive: true });
    const lines = [
      line("session_start", "s0", { attrs: { copilotVersion: "0.0.0" } }),
      line("user_message", "s1", { attrs: { content: USAGE_LOG_USER_MESSAGE } }),
      line("tool_call", "t1", {
        name: "read_file",
        dur: 40,
        attrs: { args: '{"filePath":"/workspace/example/a.ts"}', result: "RESULT-MUST-NOT-SURVIVE" },
      }),
      line("tool_call", "t2", { name: "semantic_search", status: "error", attrs: { args: '{"query":"x"}', error: "Canceled" } }),
      line("tool_call", "t3", {
        name: "create_file",
        status: "error",
        attrs: { args: JSON.stringify({ filePath: "/workspace/example/n.ts", content: "y".repeat(50_000) }), error: "File already exists" },
      }),
    ];
    writeFileSync(path.join(debugLogsDir, USAGE_SESSION_ID, "main.jsonl"), `${lines.join("\n")}\n`);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const provider = () => new VscodeLogProvider({ sessionStoreDbPath: dbPath, debugLogsDirPaths: [debugLogsDir], agentTracesDbPath: null });

  it("lists each span with its outcome, duration and kind", async () => {
    const detail = await provider().readSession(USAGE_SESSION_ID);
    const calls = detail!.turns[0].toolCalls;

    expect(calls.map((call) => [call.name, call.outcome?.status])).toEqual([
      ["read_file", "success"],
      ["semantic_search", "canceled"],
      ["create_file", "error"],
    ]);
    expect(calls[0].durationMs).toBe(40);
    expect(calls[0].argsSummary).toBe("/workspace/example/a.ts");
  });

  it("bounds a 50 KB argument string and never carries the result", async () => {
    const detail = await provider().readSession(USAGE_SESSION_ID);
    const calls = detail!.turns[0].toolCalls;

    expect(calls[2].argsSummary.length).toBeLessThanOrEqual(MAX_ARGS_SUMMARY_LENGTH);
    expect(JSON.stringify(detail)).not.toContain("RESULT-MUST-NOT-SURVIVE");
  });

  it("leaves the list path without tool calls", async () => {
    const [listed] = await provider().listSessions();

    expect(listed.turns).toEqual([]);
  });
});
