import { describe, expect, it } from "vitest";
import { turnViewSchema, unavailableTokenCount, type Session, type Turn } from "@agent-cost-analyzer/domain";
import { buildTurnView } from "./turn-view-builder.js";

const usage = {
  uncachedInput: { known: true as const, value: 10 },
  cacheWrite: { known: true as const, value: 0 },
  cacheRead: { known: true as const, value: 90 },
  tool: unavailableTokenCount("n/a"),
  vision: unavailableTokenCount("n/a"),
  reasoning: unavailableTokenCount("n/a"),
  output: { known: true as const, value: 5 },
  costAiCredits: unavailableTokenCount("n/a"),
  model: "m",
};

function session(turns: Partial<Turn>[]): Session {
  return {
    id: "s1",
    mode: "analyze",
    providerId: "claude-code",
    title: "T",
    model: "m",
    turns: turns.map((turn, index) => ({
      index,
      userMessage: "hello",
      assistantResponse: "world",
      toolCalls: [],
      usage,
      explanation: "why",
      ...turn,
    })),
    turnCount: turns.length,
    costAiCredits: unavailableTokenCount("n/a"),
    usageDataAvailable: true,
  };
}

describe("buildTurnView", () => {
  it("says text and tool calls are unavailable for an Agent Host turn, so empty values aren't read as empty", () => {
    const view = buildTurnView({ ...session([{ userMessage: "", assistantResponse: "" }]), copilotHarness: "agent-host" }, 0);

    expect(view?.textUnavailableReason).toMatch(/Agent Host/);
    expect(view?.toolCallsUnavailableReason).toMatch(/Agent Host/);
    expect(turnViewSchema.parse(view)).toEqual(view);
  });

  it("leaves the unavailable reasons out for other sessions", () => {
    const view = buildTurnView(session([{}]), 0);

    expect(view?.textUnavailableReason).toBeUndefined();
    expect(view?.toolCallsUnavailableReason).toBeUndefined();
  });

  it("returns one turn with its usage and compact tool calls", () => {
    const view = buildTurnView(
      session([
        {},
        {
          triggeredEvent: "compaction",
          toolCalls: [
            {
              name: "Bash",
              kind: "shell",
              argsSummary: "npm test",
              shell: { command: "npm test", program: "npm" },
              outcome: { status: "error", exitCode: 1, failureCategory: "test-or-build-failure" },
              durationMs: 1200,
            },
            { name: "Read", argsSummary: "src/a.ts" },
          ],
        },
      ]),
      1,
    );

    expect(view && turnViewSchema.parse(view)).toEqual(view);
    expect(view).toMatchObject({
      sessionId: "s1",
      providerId: "claude-code",
      turnIndex: 1,
      turnCount: 2,
      triggeredEvent: "compaction",
      userMessage: "hello",
      userMessageTruncated: false,
      usage,
    });
    expect(view!.toolCalls).toEqual([
      { name: "Bash", kind: "shell", status: "error", failureCategory: "test-or-build-failure", exitCode: 1, command: "npm test", durationMs: 1200 },
      { name: "Read", kind: "file-read", status: "unknown", command: "src/a.ts" },
    ]);
  });

  it("redacts secrets and truncates long text to maxTextChars", () => {
    const view = buildTurnView(
      session([{ userMessage: "use api_key=abcd1234efgh please", assistantResponse: "x".repeat(50), explanation: "y".repeat(50) }]),
      0,
      { maxTextChars: 20 },
    )!;

    expect(view.userMessage).not.toContain("abcd1234efgh");
    expect(view.assistantResponse).toHaveLength(20);
    expect(view.assistantResponse.endsWith("…")).toBe(true);
    expect(view.assistantResponseTruncated).toBe(true);
    expect(view.explanation.length).toBeLessThanOrEqual(20);
  });

  it("returns null for a turn index the session doesn't have", () => {
    expect(buildTurnView(session([{}]), 5)).toBeNull();
  });
});
