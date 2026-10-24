import { describe, expect, it } from "vitest";
import { estimatedTokenCount, type ToolCallRecord } from "@copilot-cost-analyzer/domain";
import { analyzeSession, bash, providerSessions, turn, usage } from "../../test-support/insights-fakes.js";
import { buildInsightRows } from "./insights-dataset-builder.js";

describe("buildInsightRows", () => {
  it("flattens sessions, turns and tool calls with provider-scoped keys", () => {
    const rows = buildInsightRows([
      providerSessions([analyzeSession("s1", "2026-10-10T09:15:00.000Z", [turn(0, [bash("npm test")])], "gpt-5")], "vscode", "VS Code"),
    ]);

    expect(rows.sessions).toEqual([
      {
        key: "vscode:s1",
        providerId: "vscode",
        providerLabel: "VS Code",
        sessionId: "s1",
        title: "Session s1",
        model: "gpt-5",
        startedAt: "2026-10-10T09:15:00.000Z",
        date: "2026-10-10",
        hour: 9,
      },
    ]);
    expect(rows.turns[0]).toMatchObject({ key: "vscode:s1:0", sessionKey: "vscode:s1", turnIndex: 0, toolCallCount: 1 });
    expect(rows.toolCalls).toEqual([
      {
        key: "vscode:s1:0:0",
        turnKey: "vscode:s1:0",
        name: "Bash",
        kind: "shell",
        program: "npm",
        status: "success",
        command: "npm test",
      },
    ]);
  });

  it("keeps the same session id from two providers apart", () => {
    const rows = buildInsightRows([
      providerSessions([analyzeSession("s1", undefined, [turn(0)])], "a"),
      providerSessions([analyzeSession("s1", undefined, [turn(0)])], "b"),
    ]);
    expect(rows.sessions.map((row) => row.key)).toEqual(["a:s1", "b:s1"]);
    expect(rows.turns.map((row) => row.key)).toEqual(["a:s1:0", "b:s1:0"]);
  });

  it("turns an unknown token figure into null, not 0", () => {
    const rows = buildInsightRows([
      providerSessions([analyzeSession("s1", undefined, [turn(0, [], usage({ credits: null, read: 500 }))])]),
    ]);
    expect(rows.turns[0]).toMatchObject({ aiCredits: null, cacheRead: 500, reasoning: null, estimated: false });
  });

  it("marks a turn whose figures include a local-tokenizer estimate", () => {
    const estimatedUsage = { ...usage(), uncachedInput: estimatedTokenCount(42) };
    const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [turn(0, [], estimatedUsage)])])]);
    expect(rows.turns[0]).toMatchObject({ uncachedInput: 42, estimated: true });
  });

  it("omits date and hour when the session has no start time", () => {
    const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [])])]);
    expect(rows.sessions[0]).not.toHaveProperty("date");
    expect(rows.sessions[0]).not.toHaveProperty("hour");
  });

  it("resolves a missing kind, defaults a missing outcome to unknown, and bounds + redacts the command", () => {
    const secret = "ghp_" + "a".repeat(36);
    const call: ToolCallRecord = { name: "run_in_terminal", argsSummary: `echo ${secret} ${"x".repeat(400)}` };
    const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [turn(0, [call])])])]);
    const [row] = rows.toolCalls;
    expect(row).toMatchObject({ kind: "shell", status: "unknown" });
    expect(row?.command).not.toContain(secret);
    expect(row?.command?.length).toBeLessThanOrEqual(200);
  });

  it("carries the failure category, timing and program", () => {
    const call: ToolCallRecord = {
      ...bash("rg foo", "error", "2026-10-10T09:16:00.000Z"),
      outcome: { status: "error", failureCategory: "command-not-found" },
      durationMs: 12,
    };
    const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [turn(0, [call])])])]);
    expect(rows.toolCalls[0]).toMatchObject({
      program: "rg",
      status: "error",
      failureCategory: "command-not-found",
      startedAt: "2026-10-10T09:16:00.000Z",
      durationMs: 12,
    });
  });
});
