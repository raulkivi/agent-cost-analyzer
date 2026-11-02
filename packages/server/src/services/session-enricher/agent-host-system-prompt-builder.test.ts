import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { estimateTokenCount } from "../../data-sources/jsonl/token-estimator.js";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import {
  AGENT_HOST_TOOL_DEFINITIONS_UNAVAILABLE_REASON,
  buildAgentHostSystemPrompt,
  lookupAgentHostSystemPromptText,
} from "./agent-host-system-prompt-builder.js";

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
    .filter((raw) => typeof raw.id === "string" && typeof raw.type === "string")
    .map((raw) => ({
      id: raw.id as string,
      type: raw.type as string,
      parentId: (raw.parentId as string | undefined) ?? null,
      timestamp: (raw.timestamp as string | undefined) ?? null,
      agentId: (raw.agentId as string | undefined) ?? null,
      data: (raw.data ?? {}) as Record<string, unknown>,
    }));
}

let seq = 0;
function ev(type: string, data: Record<string, unknown>, agentId: string | null = null): CopilotEvent {
  seq += 1;
  return { id: `e${seq}`, type, parentId: null, timestamp: null, agentId, data };
}
const sys = (content: string, agentId: string | null = null) => ev("system.message", { role: "system", content }, agentId);

describe("buildAgentHostSystemPrompt", () => {
  it("is null without a main-agent system.message", () => {
    expect(buildAgentHostSystemPrompt([])).toBeNull();
    expect(buildAgentHostSystemPrompt([sys("sub", "agent-1"), ev("session.shutdown", { systemTokens: 5 })])).toBeNull();
    expect(buildAgentHostSystemPrompt([ev("system.message", { content: "" })])).toBeNull();
  });

  it("uses real tokens from the last shutdown for the fixture with one prompt", () => {
    const built = buildAgentHostSystemPrompt(fixtureEvents("5d1a0001-aaaa-4bbb-8ccc-000000000001"));

    expect(built?.text).toContain("You are a coding agent");
    expect(built?.components).toEqual([
      { kind: "built-in", label: expect.stringContaining("Base system prompt"), tokenCount: { known: true, value: 4100 } },
      { kind: "tool-definitions", label: "Tool definitions", tokenCount: { known: true, value: 1000 } },
    ]);
  });

  it("takes the latest main prompt and the counts that follow it (re-emit fixture)", () => {
    const built = buildAgentHostSystemPrompt(fixtureEvents("5d1a0003-aaaa-4bbb-8ccc-000000000003"));

    expect(built?.text).toContain("second emission");
    expect(built?.components[0].tokenCount).toEqual({ known: true, value: 4100 });
    expect(built?.components[1].tokenCount).toEqual({ known: true, value: 1000 });
  });

  it("ignores subagent system messages and snapshots", () => {
    const built = buildAgentHostSystemPrompt(fixtureEvents("5d1a0002-aaaa-4bbb-8ccc-000000000002"));

    expect(built?.text).toBeTruthy();
    // no shutdown in this fixture: estimated
    expect(built?.components[0].tokenCount).toEqual(estimateTokenCount(built!.text));
  });

  it("estimates when the counts predate the latest prompt", () => {
    const built = buildAgentHostSystemPrompt([
      sys("old"),
      ev("session.compaction_start", { systemTokens: 99, toolDefinitionsTokens: 7 }),
      sys("new prompt text"),
    ]);

    expect(built?.components[0].tokenCount).toEqual(estimateTokenCount("new prompt text"));
    expect(built?.components[1].tokenCount).toEqual({
      known: false,
      reason: AGENT_HOST_TOOL_DEFINITIONS_UNAVAILABLE_REASON,
    });
  });

  it("uses the last count after the prompt, from compaction_start or shutdown", () => {
    const built = buildAgentHostSystemPrompt([
      sys("p"),
      ev("session.compaction_start", { systemTokens: 10, toolDefinitionsTokens: 5 }),
      ev("session.shutdown", { systemTokens: 12, toolDefinitionsTokens: 6 }),
    ]);

    expect(built?.components.map((c) => c.tokenCount)).toEqual([
      { known: true, value: 12 },
      { known: true, value: 6 },
    ]);
  });

  it("treats non-numeric or negative counts as absent, never 0", () => {
    const built = buildAgentHostSystemPrompt([sys("p"), ev("session.shutdown", { systemTokens: "x", toolDefinitionsTokens: -1 })]);

    expect(built?.components[0].tokenCount).toEqual(estimateTokenCount("p"));
    expect(built?.components[1].tokenCount.known).toBe(false);
  });

  it("falls back per field: real tool tokens, estimated system tokens", () => {
    const built = buildAgentHostSystemPrompt([sys("p"), ev("session.shutdown", { toolDefinitionsTokens: 8 })]);

    expect(built?.components[0].tokenCount).toEqual(estimateTokenCount("p"));
    expect(built?.components[1].tokenCount).toEqual({ known: true, value: 8 });
  });
});

describe("lookupAgentHostSystemPromptText", () => {
  it("is found with the latest main prompt", () => {
    expect(lookupAgentHostSystemPromptText([sys("a"), sys("b")])).toEqual({ status: "found", text: "b" });
  });

  it("is not-captured without one", () => {
    expect(lookupAgentHostSystemPromptText([sys("x", "agent-1")])).toEqual({ status: "not-captured" });
  });
});
