import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { JsonlEnvelope } from "../../jsonl/main-jsonl-reader.js";
import { readMainJsonlEnvelopesForTurn } from "../../jsonl/turn-inspector-reader.js";
import { buildTurnInspectorDetail } from "./turn-inspector-builder.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures/jsonl",
);
const realSessionPath = path.join(fixturesDir, "real-session-with-usage.jsonl");

function textMessage(role: string, text: string) {
  return { role, parts: [{ type: "text", content: text }] };
}

// Hand-authored envelopes (rather than the real, redacted fixture): the
// shared real-session-with-usage.jsonl fixture had its inputMessages/args/
// result content redacted to short placeholder strings for privacy, which
// destroys the actual message-array structure this suffix-diff logic
// depends on. These mirror the shape confirmed against this machine's own
// real, unredacted main.jsonl (refined during implementation):
// `inputMessages`/`response` are JSON-*encoded strings* of
// a `[{ role, parts: [{ type, content }, ...] }, ...]` array — a second
// layer of stringification on top of the already-JSON log line — with
// realistic content so the diff can be asserted precisely.
function buildTwoRoundEnvelopes(): JsonlEnvelope[] {
  return [
    { type: "user_message", attrs: { content: "Fix the bug" } },
    {
      type: "tool_call",
      name: "read_file",
      attrs: { args: { path: "src/foo.ts" }, result: "line1\nline2" },
    },
    {
      type: "llm_request",
      attrs: { inputMessages: JSON.stringify([textMessage("system", "You are an agent.")]) },
    },
    {
      type: "agent_response",
      attrs: {
        response: JSON.stringify([textMessage("assistant", "I read the file.")]),
        reasoning: "Let me check it.",
      },
    },
    {
      type: "tool_call",
      name: "run_in_terminal",
      attrs: { args: { command: "npm test" }, result: "All tests passed" },
    },
    {
      type: "llm_request",
      attrs: {
        inputMessages: JSON.stringify([
          textMessage("system", "You are an agent."),
          textMessage("assistant", "I read the file."),
          textMessage("tool", "All tests passed"),
        ]),
      },
    },
    { type: "agent_response", attrs: { response: JSON.stringify([textMessage("assistant", "Done.")]) } },
  ];
}

describe("buildTurnInspectorDetail", () => {
  it("extracts the turn's own user message", () => {
    const detail = buildTurnInspectorDetail(0, buildTwoRoundEnvelopes(), 0);

    expect(detail.turnIndex).toBe(0);
    expect(detail.userMessage).toEqual([{ kind: "text", text: "Fix the bug" }]);
  });

  it("splits into one round per llm_request/agent_response pair, attaching preceding tool calls to the round that follows", () => {
    const detail = buildTurnInspectorDetail(0, buildTwoRoundEnvelopes(), 0);

    expect(detail.rounds).toHaveLength(2);
    expect(detail.rounds[0].request.toolCalls).toHaveLength(1);
    expect(detail.rounds[0].request.toolCalls[0].name).toBe("read_file");
    expect(detail.rounds[1].request.toolCalls).toHaveLength(1);
    expect(detail.rounds[1].request.toolCalls[0].name).toBe("run_in_terminal");
  });

  it("round 0's addedMessages is the full inputMessages array (no predecessor)", () => {
    const detail = buildTurnInspectorDetail(0, buildTwoRoundEnvelopes(), 0);

    expect(detail.rounds[0].request.addedMessages).toEqual([
      { kind: "text", text: "You are an agent." },
    ]);
  });

  it("round 1's addedMessages is only the suffix beyond round 0's inputMessages length", () => {
    const detail = buildTurnInspectorDetail(0, buildTwoRoundEnvelopes(), 0);

    expect(detail.rounds[1].request.addedMessages).toEqual([
      { kind: "text", text: "I read the file." },
      { kind: "text", text: "All tests passed" },
    ]);
  });

  it("uses previousInputMessagesLength as round 0's baseline when the turn has a predecessor", () => {
    const envelopes = buildTwoRoundEnvelopes();
    const detail = buildTurnInspectorDetail(1, envelopes, 1);

    expect(detail.rounds[0].request.addedMessages).toEqual([]);
  });

  it("populates a known file-reading tool's path placeholder for its args", () => {
    const detail = buildTurnInspectorDetail(0, buildTwoRoundEnvelopes(), 0);

    expect(detail.rounds[0].request.toolCalls[0].args).toEqual([
      { placeholder: true, kind: "file", path: "src/foo.ts", sizeBytes: expect.any(Number) },
    ]);
  });

  it("shows reasoning inline on the response round when present, omits it when absent", () => {
    const detail = buildTurnInspectorDetail(0, buildTwoRoundEnvelopes(), 0);

    expect(detail.rounds[0].response.reasoning).toEqual([{ kind: "text", text: "Let me check it." }]);
    expect(detail.rounds[1].response.reasoning).toBeUndefined();
  });

  it("extracts response text from the JSON-encoded response message array", () => {
    const detail = buildTurnInspectorDetail(0, buildTwoRoundEnvelopes(), 0);

    expect(detail.rounds[0].response.response).toEqual([{ kind: "text", text: "I read the file." }]);
    expect(detail.rounds[1].response.response).toEqual([{ kind: "text", text: "Done." }]);
  });

  it("falls back to best-effort text when inputMessages isn't a JSON-encoded array (older/redacted shape)", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "user_message", attrs: { content: "hi" } },
      { type: "llm_request", attrs: { inputMessages: "<redacted input messages>" } },
      { type: "agent_response", attrs: { response: "hello" } },
    ];

    const detail = buildTurnInspectorDetail(0, envelopes, 0);

    expect(detail.rounds[0].request.addedMessages).toEqual([
      { kind: "text", text: "<redacted input messages>" },
    ]);
  });

  it("stringifies a tool_call/tool_call_response message part rather than dropping it (no single content field)", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "user_message", attrs: { content: "hi" } },
      {
        type: "llm_request",
        attrs: {
          inputMessages: JSON.stringify([
            {
              role: "assistant",
              parts: [{ type: "tool_call", id: "t1", name: "read_file", arguments: { path: "a.ts" } }],
            },
          ]),
        },
      },
      { type: "agent_response", attrs: { response: JSON.stringify([textMessage("assistant", "ok")]) } },
    ];

    const detail = buildTurnInspectorDetail(0, envelopes, 0);

    expect(detail.rounds[0].request.addedMessages).toHaveLength(1);
    expect(detail.rounds[0].request.addedMessages[0].kind).toBe("text");
    expect((detail.rounds[0].request.addedMessages[0] as { text: string }).text).toContain("tool_call");
  });

  it("returns rounds: [] for a turn with a user_message but no llm_request (no model call made)", () => {
    const envelopes: JsonlEnvelope[] = [
      { type: "user_message", attrs: { content: "just chatting" } },
      { type: "turn_end" },
    ];

    const detail = buildTurnInspectorDetail(0, envelopes, 0);

    expect(detail.rounds).toEqual([]);
  });

  it("integrates with the real captured fixture: 2 rounds per turn, tool names and reasoning presence match the log", async () => {
    const turn0 = await readMainJsonlEnvelopesForTurn(realSessionPath, 0);
    const detail0 = buildTurnInspectorDetail(0, turn0!.turnEnvelopes, turn0!.previousInputMessagesLength);

    expect(detail0.rounds).toHaveLength(2);
    expect(detail0.rounds[0].request.toolCalls[0].name).toBe("manage_todo_list");
    expect(detail0.rounds[1].request.toolCalls[0].name).toBe("read_file");
    expect(detail0.rounds[0].response.reasoning).toBeDefined();

    const turn1 = await readMainJsonlEnvelopesForTurn(realSessionPath, 1);
    const detail1 = buildTurnInspectorDetail(1, turn1!.turnEnvelopes, turn1!.previousInputMessagesLength);

    expect(detail1.rounds).toHaveLength(2);
    expect(detail1.rounds[0].request.toolCalls[0].name).toBe("manage_todo_list");
    expect(detail1.rounds[1].request.toolCalls[0].name).toBe("run_in_terminal");
    // The fixture's final agent_response (line index 31) has no reasoning key.
    expect(detail1.rounds[1].response.reasoning).toBeUndefined();
  });
});
