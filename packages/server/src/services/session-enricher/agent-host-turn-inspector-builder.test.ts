import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import { PLACEHOLDER_THRESHOLD_CHARS } from "../../data-sources/log-providers/build-content-parts.js";
import { buildAgentHostTurnInspector } from "./agent-host-turn-inspector-builder.js";
import { segmentCopilotTurns, type MatchedTurn } from "./copilot-turn-segmenter.js";

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/agent-host/copilot-cli/session-state",
);

// The real reader is a separate task; fixtures are well-formed JSONL.
function fixtureEvents(sessionDir: string): CopilotEvent[] {
  return readFileSync(path.join(fixtureDir, sessionDir, "events.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((raw) => ({
      id: raw.id as string,
      type: raw.type as string,
      parentId: (raw.parentId as string | undefined) ?? null,
      timestamp: (raw.timestamp as string | undefined) ?? null,
      agentId: (raw.agentId as string | undefined) ?? null,
      data: (raw.data ?? {}) as Record<string, unknown>,
    }));
}

function fixtureTurns(sessionDir: string): MatchedTurn[] {
  const events = fixtureEvents(sessionDir);
  const users = events.filter((e) => e.type === "user.message" && e.agentId === null);
  const log = segmentCopilotTurns(
    events,
    users.map((u, i) => ({ turnId: `request_${i}`, eventId: u.id })),
  );
  return log.turns.filter((t): t is MatchedTurn => t.matched);
}

let seq = 0;
function ev(type: string, data: Record<string, unknown>, agentId: string | null = null): CopilotEvent {
  seq += 1;
  return { id: `e${seq}`, type, parentId: null, timestamp: null, agentId, data };
}
function turnOf(userData: Record<string, unknown>, ...events: CopilotEvent[]): MatchedTurn {
  return { turnId: "t", matched: true, userMessage: ev("user.message", userData), events };
}
const start = (agentId: string | null = null) => ev("assistant.turn_start", { turnId: "0" }, agentId);
const message = (data: Record<string, unknown>, agentId: string | null = null) =>
  ev("assistant.message", { content: "", toolRequests: [], ...data }, agentId);
const complete = (toolCallId: string, data: Record<string, unknown> = {}) =>
  ev("tool.execution_complete", { toolCallId, success: true, ...data });

describe("buildAgentHostTurnInspector", () => {
  it("returns rounds: [] and the user message for a turn with no model round-trip", () => {
    const detail = buildAgentHostTurnInspector(3, turnOf({ content: "hi" }));
    expect(detail).toEqual({ turnIndex: 3, userMessage: [{ kind: "text", text: "hi" }], rounds: [] });
  });

  it("shows the user's typed text as userMessage and the model-seen text as round 0's request", () => {
    const detail = buildAgentHostTurnInspector(
      0,
      turnOf({ content: "typed", transformedContent: "<dt/>typed" }, start(), message({ content: "ok" })),
    );
    expect(detail.userMessage).toEqual([{ kind: "text", text: "typed" }]);
    expect(detail.rounds[0]!.request.addedMessages).toEqual([{ kind: "text", text: "<dt/>typed" }]);
    expect(detail.rounds[0]!.request.index).toBe(0);
  });

  it("falls back to content when transformedContent is missing", () => {
    const detail = buildAgentHostTurnInspector(0, turnOf({ content: "typed" }, start(), message({})));
    expect(detail.rounds[0]!.request.addedMessages).toEqual([{ kind: "text", text: "typed" }]);
  });

  it("builds one round per main-agent turn_start with content, reasoning and tool requests", () => {
    const detail = buildAgentHostTurnInspector(
      0,
      turnOf(
        { content: "go" },
        start(),
        message({
          content: "Looking.",
          reasoningText: "think",
          toolRequests: [{ toolCallId: "c1", name: "view", arguments: { path: "/a" } }],
        }),
        complete("c1", { result: { content: "a.ts" } }),
        start(),
        message({ content: "Done." }),
      ),
    );
    expect(detail.rounds).toHaveLength(2);
    const [r0, r1] = detail.rounds;
    expect(r0!.response.response).toEqual([
      { kind: "text", text: "Looking." },
      { kind: "text", text: JSON.stringify({ name: "view", arguments: { path: "/a" } }) },
    ]);
    expect(r0!.response.reasoning).toEqual([{ kind: "text", text: "think" }]);
    expect(r0!.response.index).toBe(0);
    expect(r1!.response.response).toEqual([{ kind: "text", text: "Done." }]);
    expect(r1!.response.reasoning).toBeUndefined();
    expect(r1!.request.index).toBe(1);
  });

  it("feeds tool results completed in the previous round into the next round's request", () => {
    const detail = buildAgentHostTurnInspector(
      0,
      turnOf(
        { content: "go" },
        start(),
        message({ toolRequests: [{ toolCallId: "c1", name: "bash", arguments: { command: "ls" } }] }),
        complete("c1", { result: { content: "x" } }),
        start(),
        message({ content: "end" }),
      ),
    );
    expect(detail.rounds[0]!.request.toolCalls).toEqual([]);
    expect(detail.rounds[1]!.request.addedMessages).toEqual([]);
    expect(detail.rounds[1]!.request.toolCalls).toEqual([
      {
        name: "bash",
        args: [{ kind: "text", text: JSON.stringify({ command: "ls" }) }],
        result: [{ kind: "text", text: "x" }],
      },
    ]);
  });

  it("shows a failed call's error and an interrupted call as having no recorded result", () => {
    const detail = buildAgentHostTurnInspector(
      0,
      turnOf(
        { content: "go" },
        start(),
        message({
          toolRequests: [
            { toolCallId: "c1", name: "bash", arguments: {} },
            { toolCallId: "c2", name: "bash", arguments: {} },
          ],
        }),
        complete("c1", { success: false, error: { code: "failure", message: "exit 1" } }),
        start(),
        message({ content: "end" }),
      ),
    );
    const [failed, interrupted] = detail.rounds[1]!.request.toolCalls;
    expect(failed!.result).toEqual([{ kind: "text", text: "Error (failure): exit 1" }]);
    expect(interrupted!.result).toEqual([
      { kind: "text", text: "No result recorded for this call in this turn." },
    ]);
  });

  it("collapses oversized tool results into a file placeholder", () => {
    const big = "x".repeat(PLACEHOLDER_THRESHOLD_CHARS + 1);
    const detail = buildAgentHostTurnInspector(
      0,
      turnOf(
        { content: "go" },
        start(),
        message({ toolRequests: [{ toolCallId: "c1", name: "view", arguments: {} }] }),
        complete("c1", { result: { content: big } }),
        start(),
        message({}),
      ),
    );
    expect(detail.rounds[1]!.request.toolCalls[0]!.result).toEqual([
      { placeholder: true, kind: "file", sizeBytes: big.length },
    ]);
  });

  it("excludes subagent events from rounds but keeps the parent task call's result", () => {
    const detail = buildAgentHostTurnInspector(
      0,
      turnOf(
        { content: "go" },
        start(),
        message({ toolRequests: [{ toolCallId: "t1", name: "task", arguments: { prompt: "p" } }] }),
        start("agent-1"),
        message({ content: "sub text", toolRequests: [{ toolCallId: "s1", name: "grep", arguments: {} }] }, "agent-1"),
        { ...complete("s1", { result: { content: "sub result" } }), agentId: "agent-1" },
        complete("t1", { result: { content: "Subagent result text." } }),
        start(),
        message({ content: "fin" }),
      ),
    );
    expect(detail.rounds).toHaveLength(2);
    expect(JSON.stringify(detail)).not.toContain("sub text");
    expect(detail.rounds[1]!.request.toolCalls).toHaveLength(1);
    expect(detail.rounds[1]!.request.toolCalls[0]!.name).toBe("task");
  });

  describe("attachments", () => {
    it("turns file, selection and directory attachments into path placeholders", () => {
      const detail = buildAgentHostTurnInspector(
        0,
        turnOf(
          {
            content: "x",
            attachments: [
              { type: "file", path: "/a/main.ts" },
              { type: "selection", path: "/a/util.ts", taggedFilesEntry: "SECRET-BODY" },
              { type: "directory", path: "/a/src" },
            ],
          },
          start(),
          message({}),
        ),
      );
      const chips = [
        { placeholder: true, kind: "file", path: "/a/main.ts" },
        { placeholder: true, kind: "file", path: "/a/util.ts" },
        { placeholder: true, kind: "file", path: "/a/src" },
      ];
      expect(detail.userMessage.slice(1)).toEqual(chips);
      expect(detail.rounds[0]!.request.addedMessages.slice(1)).toEqual(chips);
      expect(JSON.stringify(detail)).not.toContain("SECRET-BODY");
    });

    it("turns a text blob into a sized file chip, never inlining its data", () => {
      const data = Buffer.from("pasted text").toString("base64");
      const detail = buildAgentHostTurnInspector(
        0,
        turnOf(
          { content: "x", attachments: [{ type: "blob", data, mimeType: "text/plain", displayName: "pasted.txt" }] },
          start(),
          message({}),
        ),
      );
      expect(detail.userMessage[1]).toEqual({ placeholder: true, kind: "file", path: "pasted.txt", sizeBytes: 11 });
      expect(JSON.stringify(detail)).not.toContain(data);
    });

    it("turns an image blob and its session.binary_asset into one image chip", () => {
      const data = Buffer.from("PLACEHOLDER").toString("base64");
      const detail = buildAgentHostTurnInspector(
        0,
        turnOf(
          { content: "x", attachments: [{ type: "blob", data, mimeType: "image/png", assetId: "a1" }] },
          ev("session.binary_asset", { assetId: "a1", type: "image", mimeType: "image/png", byteLength: 11, data }),
          start(),
          message({}),
        ),
      );
      expect(detail.userMessage.slice(1)).toEqual([{ placeholder: true, kind: "image", sizeBytes: 11 }]);
      expect(JSON.stringify(detail)).not.toContain(data);
    });

    it("adds an image chip for a binary asset no attachment refers to", () => {
      const detail = buildAgentHostTurnInspector(
        0,
        turnOf({ content: "x" }, ev("session.binary_asset", { assetId: "z", type: "image", byteLength: 5, data: "QQ==" }), start(), message({})),
      );
      expect(detail.userMessage.slice(1)).toEqual([{ placeholder: true, kind: "image", sizeBytes: 5 }]);
    });
  });

  describe("fixtures", () => {
    it("builds the normal session's two-round turn with a failed bash result", () => {
      const turns = fixtureTurns("5d1a0001-aaaa-4bbb-8ccc-000000000001");
      const detail = buildAgentHostTurnInspector(0, turns[0]!);
      expect(detail.rounds).toHaveLength(2);
      expect(detail.rounds[1]!.request.toolCalls.map((c) => c.name)).toEqual(["view", "bash"]);
      expect(detail.rounds[1]!.request.toolCalls[1]!.result).toEqual([
        { kind: "text", text: "Error (failure): Command exited with code 1." },
      ]);
      expect(detail.rounds[1]!.response.response).toEqual([{ kind: "text", text: "Example answer one." }]);
      expect(detail.rounds[0]!.request.addedMessages[0]).toMatchObject({ kind: "text" });
    });

    it("shows the image and no base64 for the second turn", () => {
      const turns = fixtureTurns("5d1a0001-aaaa-4bbb-8ccc-000000000001");
      const detail = buildAgentHostTurnInspector(1, turns[1]!);
      expect(detail.userMessage.some((p) => "placeholder" in p && p.kind === "image")).toBe(true);
      expect(JSON.stringify(detail)).not.toContain("UExBQ0VIT0xERVI=");
    });

    it("leaves subagent rounds out of the subagent session's turn", () => {
      const turns = fixtureTurns("5d1a0002-aaaa-4bbb-8ccc-000000000002");
      const detail = buildAgentHostTurnInspector(0, turns[0]!);
      expect(detail.rounds).toHaveLength(2);
      expect(detail.rounds[1]!.request.toolCalls.map((c) => c.name)).toEqual(["task"]);
    });

    it("gives the aborted turn one round whose call has no result and no later round", () => {
      const turns = fixtureTurns("5d1a0002-aaaa-4bbb-8ccc-000000000002");
      const detail = buildAgentHostTurnInspector(2, turns[turns.length - 1]!);
      expect(detail.rounds).toHaveLength(1);
      expect(detail.rounds[0]!.response.response).toHaveLength(1);
    });
  });
});
