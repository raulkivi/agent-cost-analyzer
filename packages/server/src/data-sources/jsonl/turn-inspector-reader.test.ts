import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readMainJsonlEnvelopesForTurn } from "./turn-inspector-reader.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/jsonl",
);
const realSessionPath = path.join(fixturesDir, "real-session-with-usage.jsonl");
const missingPath = path.join(fixturesDir, "does-not-exist.jsonl");

describe("readMainJsonlEnvelopesForTurn", () => {
  it("isolates the first user_message-to-user_message span for turnIndex 0", async () => {
    const result = await readMainJsonlEnvelopesForTurn(realSessionPath, 0);

    expect(result).not.toBeNull();
    expect(result!.turnEnvelopes[0].type).toBe("user_message");
    // Turn 0's span (confirmed against the fixture): 2 llm_request/
    // agent_response/tool_call round-trips before the next user_message.
    const types = result!.turnEnvelopes.map((envelope) => envelope.type);
    expect(types.filter((type) => type === "llm_request")).toHaveLength(2);
    expect(types.filter((type) => type === "agent_response")).toHaveLength(2);
    expect(types.filter((type) => type === "tool_call")).toHaveLength(2);
    // Exactly one user_message: the stream stops at the next one rather
    // than reading past it into turn 1's span.
    expect(types.filter((type) => type === "user_message")).toHaveLength(1);
  });

  it("isolates the second span for turnIndex 1, stopping at EOF", async () => {
    const result = await readMainJsonlEnvelopesForTurn(realSessionPath, 1);

    expect(result).not.toBeNull();
    expect(result!.turnEnvelopes[0].type).toBe("user_message");
    const types = result!.turnEnvelopes.map((envelope) => envelope.type);
    expect(types.filter((type) => type === "llm_request")).toHaveLength(2);
    expect(types.filter((type) => type === "agent_response")).toHaveLength(2);
  });

  it("keeps wide-content attrs keys (content/inputMessages/response/reasoning/args/result) that the narrow reader drops", async () => {
    const result = await readMainJsonlEnvelopesForTurn(realSessionPath, 0);

    const userMessage = result!.turnEnvelopes.find((envelope) => envelope.type === "user_message");
    const llmRequest = result!.turnEnvelopes.find((envelope) => envelope.type === "llm_request");
    const agentResponse = result!.turnEnvelopes.find((envelope) => envelope.type === "agent_response");
    const toolCall = result!.turnEnvelopes.find((envelope) => envelope.type === "tool_call");

    expect(userMessage?.attrs?.content).toBeDefined();
    expect(llmRequest?.attrs?.inputMessages).toBeDefined();
    expect(llmRequest?.attrs?.userRequest).toBeDefined();
    expect(agentResponse?.attrs?.response).toBeDefined();
    expect(agentResponse?.attrs?.reasoning).toBeDefined();
    expect(toolCall?.attrs?.args).toBeDefined();
    expect(toolCall?.attrs?.result).toBeDefined();
    // Narrow-only fields (usage extraction) are not part of this path.
    expect(llmRequest?.attrs?.inputTokens).toBeUndefined();
  });

  it("returns previousInputMessagesLength 0 for the first turn (no predecessor)", async () => {
    const result = await readMainJsonlEnvelopesForTurn(realSessionPath, 0);

    expect(result!.previousInputMessagesLength).toBe(0);
  });

  it("tracks previousInputMessagesLength as 0 when no earlier llm_request had an array inputMessages (this fixture's inputMessages is redacted to a string, not an array)", async () => {
    const result = await readMainJsonlEnvelopesForTurn(realSessionPath, 1);

    expect(result!.previousInputMessagesLength).toBe(0);
  });

  it("returns null for a turnIndex with no corresponding user_message", async () => {
    await expect(readMainJsonlEnvelopesForTurn(realSessionPath, 99)).resolves.toBeNull();
  });

  it("returns null when the file doesn't exist", async () => {
    await expect(readMainJsonlEnvelopesForTurn(missingPath, 0)).resolves.toBeNull();
  });
});
