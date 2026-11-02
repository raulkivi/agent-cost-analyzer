import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import {
  buildAgentHostTurnContent,
  buildUnmatchedAgentHostTurnContent,
  indexToolOutcomeEvents,
  type AgentHostTurnContent,
} from "./agent-host-turn-content-builder.js";
import { segmentCopilotTurns, type MatchedTurn, type SegmentedTurn } from "./copilot-turn-segmenter.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/agent-host/copilot-cli");
const rows = JSON.parse(readFileSync(join(FIXTURES, "rows.json"), "utf8")) as {
  sdkSessionIds: Record<string, string>;
  turns: Record<string, { id: string; event_id: string | null }[]>;
};

function loadEvents(sdkSessionId: string): CopilotEvent[] {
  const text = readFileSync(join(FIXTURES, "session-state", sdkSessionId, "events.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const raw = JSON.parse(line) as Record<string, unknown>;
      return {
        id: raw.id as string,
        type: raw.type as string,
        parentId: (raw.parentId as string) ?? null,
        timestamp: (raw.timestamp as string) ?? null,
        agentId: (raw.agentId as string) ?? null,
        data: (raw.data as Record<string, unknown>) ?? {},
      };
    });
}

function segment(name: string): { turns: SegmentedTurn[]; events: CopilotEvent[] } {
  const events = loadEvents(rows.sdkSessionIds[name]!);
  const turns = rows.turns[name]!.map((r) => ({ turnId: r.id, eventId: r.event_id }));
  return { turns: segmentCopilotTurns(events, turns).turns, events };
}
function matchedTurn(t: SegmentedTurn): MatchedTurn {
  if (!t.matched) throw new Error("unmatched");
  return t;
}

describe("buildAgentHostTurnContent, normal session", () => {
  const { turns, events } = segment("normal");

  it("takes text from user content and the last main-agent round", () => {
    const first = buildAgentHostTurnContent(matchedTurn(turns[0]!));
    expect(first.userMessage).toBe("Example prompt one: please list the source files.");
    expect(first.assistantResponse).toBe("Example answer one.");
    const second = buildAgentHostTurnContent(matchedTurn(turns[1]!));
    expect(second.assistantResponse).toBe("Example answer two.");
  });

  it("builds records with kind, args, shell, timing and round index", () => {
    const { toolCalls } = buildAgentHostTurnContent(matchedTurn(turns[0]!));
    expect(toolCalls.map((c) => [c.id, c.name, c.kind, c.roundIndex])).toEqual([
      ["toolu_A1", "view", "file-read", 0],
      ["toolu_A2", "bash", "shell", 0],
    ]);
    const [view, bash] = toolCalls;
    expect(view!.argsSummary).toBe("/home/user/src/example/src");
    expect(view!.startedAt).toBe("2026-10-20T09:00:18.000Z");
    expect(view!.durationMs).toBe(2000);
    expect(view!.outcome).toEqual({ status: "success" });
    expect(bash!.shell).toEqual({ command: "ls -la src", program: "ls" });
    expect(bash!.argsSummary).toBe("ls -la src");
  });

  it("classifies a failed call from error.message and keeps the exit code", () => {
    const bash = buildAgentHostTurnContent(matchedTurn(turns[0]!)).toolCalls[1]!;
    expect(bash.outcome).toMatchObject({ status: "error", exitCode: 1 });
    expect(bash.outcome?.failureCategory).toBeDefined();
    expect(bash.outcome?.classificationEvidence?.excerpt).toContain("exited with code 1");
  });

  it("records files from fileEdits and treats external tools like any call", () => {
    const { toolCalls } = buildAgentHostTurnContent(matchedTurn(turns[1]!));
    expect(toolCalls.map((c) => [c.name, c.kind])).toEqual([
      ["edit", "file-write"],
      ["rename_chat", "other"],
    ]);
    expect(toolCalls[0]!.filesTouched).toEqual(["/home/user/src/example/src/main.ts"]);
    expect(toolCalls[1]!.filesTouched).toBeUndefined();
    expect(toolCalls[0]!.outcome).toEqual({ status: "success" });
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("buildAgentHostTurnContent, steering, abort and subagent", () => {
  const { turns, events } = segment("steeringAbortSubagent");

  it("counts subagent calls in the starting turn, in the round that started them", () => {
    const { toolCalls, assistantResponse } = buildAgentHostTurnContent(matchedTurn(turns[0]!));
    expect(toolCalls.map((c) => [c.id, c.kind, c.roundIndex])).toEqual([
      ["toolu_B1", "subagent", 0],
      ["toolu_B2", "search", 0],
    ]);
    expect(toolCalls[0]!.outcome).toEqual({ status: "success" });
    // the subagent's own messages are not the answer
    expect(assistantResponse).toBe("Subagent finished.");
  });

  it("leaves a call unknown when its completion is in a later turn and not supplied", () => {
    const { toolCalls } = buildAgentHostTurnContent(matchedTurn(turns[1]!));
    expect(toolCalls[0]!.id).toBe("toolu_B3");
    expect(toolCalls[0]!.outcome?.status).toBe("unknown");
    expect(toolCalls[0]!.outcome?.reason).toMatch(/no completion/i);
  });

  it("finds the completion of a steered call in a session-wide outcome index", () => {
    const { toolCalls } = buildAgentHostTurnContent(matchedTurn(turns[1]!), { outcomes: indexToolOutcomeEvents(events) });
    expect(toolCalls[0]!.outcome).toEqual({ status: "success", exitCode: 0 });
    expect(toolCalls[0]!.durationMs).toBe(4000);
  });

  it("marks a cancelled permission as denied", () => {
    const { toolCalls } = buildAgentHostTurnContent(matchedTurn(turns[3]!));
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.outcome?.status).toBe("denied");
  });
});

describe("buildAgentHostTurnContent, synthetic cases", () => {
  let n = 0;
  const ev = (type: string, data: Record<string, unknown>, extra: Partial<CopilotEvent> = {}): CopilotEvent => ({
    id: `e${n++}`,
    type,
    parentId: null,
    timestamp: null,
    agentId: null,
    data,
    ...extra,
  });
  const turn = (events: CopilotEvent[]): MatchedTurn => ({
    turnId: "t",
    matched: true,
    userMessage: ev("user.message", { content: "hi" }),
    events,
  });
  const start = (id: string, name = "bash", args: unknown = { command: "x" }) =>
    ev("tool.execution_start", { toolCallId: id, toolName: name, arguments: args });

  it("marks a never-completed call interrupted when the turn aborted", () => {
    const { toolCalls } = buildAgentHostTurnContent(turn([start("c1"), ev("abort", {})]));
    expect(toolCalls[0]!.outcome?.status).toBe("interrupted");
  });

  it("marks a never-completed call unknown with a reason without an abort", () => {
    const { toolCalls } = buildAgentHostTurnContent(turn([start("c1")]));
    expect(toolCalls[0]!.outcome).toMatchObject({ status: "unknown" });
    expect(toolCalls[0]!.outcome?.reason).toBeTruthy();
  });

  it("treats approved-for-location as approved", () => {
    const { toolCalls } = buildAgentHostTurnContent(
      turn([
        start("c1"),
        ev("permission.completed", { toolCallId: "c1", result: { kind: "approved-for-location" } }),
        ev("tool.execution_complete", { toolCallId: "c1", success: true }),
      ]),
    );
    expect(toolCalls[0]!.outcome?.status).toBe("success");
  });

  it("denies a call whose permission was rejected, even with no start event", () => {
    const { toolCalls } = buildAgentHostTurnContent(
      turn([
        ev("assistant.turn_start", { turnId: "0" }),
        ev("assistant.message", {
          content: "",
          toolRequests: [{ toolCallId: "c9", name: "bash", arguments: { command: "rm -rf x" } }],
        }),
        ev("permission.completed", { toolCallId: "c9", result: { kind: "denied-interactively-by-user" } }),
      ]),
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ id: "c9", roundIndex: 0, outcome: { status: "denied" } });
  });

  it("redacts secrets in args and shell command", () => {
    const secret = "ghp_" + "a".repeat(30);
    const { toolCalls } = buildAgentHostTurnContent(
      turn([start("c1", "bash", { command: `curl -H "x: ${secret}" host` })]),
    );
    expect(JSON.stringify(toolCalls[0])).not.toContain(secret);
  });

  it("returns empty text and no calls for a turn with no events, as known", () => {
    expect(buildAgentHostTurnContent(turn([]))).toEqual({
      userMessage: "hi",
      assistantResponse: "",
      toolCalls: [],
    });
  });

  it("uses the last main round's messages joined by newline", () => {
    const { assistantResponse } = buildAgentHostTurnContent(
      turn([
        ev("assistant.turn_start", {}),
        ev("assistant.message", { content: "early" }),
        ev("assistant.turn_start", {}),
        ev("assistant.message", { content: "a" }),
        ev("assistant.message", { content: "" }),
        ev("assistant.message", { content: "b" }),
      ]),
    );
    expect(assistantResponse).toBe("a\nb");
  });
});

describe("buildUnmatchedAgentHostTurnContent", () => {
  it("keeps text and tool calls unknown with the turn's reason", () => {
    const content: AgentHostTurnContent = buildUnmatchedAgentHostTurnContent({
      turnId: "t",
      matched: false,
      reason: "no log",
    });
    expect(content).toEqual({
      userMessage: "",
      assistantResponse: "",
      toolCalls: [],
      textUnavailableReason: "no log",
      toolCallsUnavailableReason: "no log",
    });
  });
});
