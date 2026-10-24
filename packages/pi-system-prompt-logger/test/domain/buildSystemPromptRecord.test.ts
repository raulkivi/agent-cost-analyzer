import { describe, expect, it } from "vitest";
import { buildSystemPromptRecord } from "../../src/domain/buildSystemPromptRecord.js";

function fakeCtx(
  overrides: Partial<Parameters<typeof buildSystemPromptRecord>[1]> = {},
) {
  return {
    cwd: "/home/dev/project",
    model: { provider: "anthropic", id: "claude-sonnet-5" },
    sessionManager: {
      getSessionId: () => "session-123",
      getSessionFile: () => "/home/dev/.pi/agent/sessions/session-123.jsonl",
    },
    ...overrides,
  };
}

describe("buildSystemPromptRecord", () => {
  it("captures the session id, file, model, cwd, and prompt text", () => {
    const event = { systemPrompt: "You are Pi, a coding agent." };
    const record = buildSystemPromptRecord(
      event,
      fakeCtx(),
      () => new Date("2026-09-03T10:00:00.000Z"),
    );

    expect(record.sessionId).toBe("session-123");
    expect(record.sessionFile).toBe(
      "/home/dev/.pi/agent/sessions/session-123.jsonl",
    );
    expect(record.cwd).toBe("/home/dev/project");
    expect(record.provider).toBe("anthropic");
    expect(record.modelId).toBe("claude-sonnet-5");
    expect(record.systemPrompt).toBe("You are Pi, a coding agent.");
    expect(record.systemPromptChars).toBe("You are Pi, a coding agent.".length);
    expect(record.capturedAt).toBe("2026-09-03T10:00:00.000Z");
  });

  it("extracts tool, skill, and context-file names from systemPromptOptions when present", () => {
    const event = {
      systemPrompt: "prompt text",
      systemPromptOptions: {
        selectedTools: ["read", "bash", "edit", "write"],
        skills: [{ name: "docx" }, { name: "pdf" }],
        contextFiles: [{ path: "/repo/AGENTS.md" }],
      },
    };
    const record = buildSystemPromptRecord(event, fakeCtx());

    expect(record.selectedTools).toEqual(["read", "bash", "edit", "write"]);
    expect(record.skillNames).toEqual(["docx", "pdf"]);
    expect(record.contextFilePaths).toEqual(["/repo/AGENTS.md"]);
  });

  it("tolerates a missing model, missing sessionFile, and missing systemPromptOptions", () => {
    const event = { systemPrompt: "prompt text" };
    const ctx = fakeCtx({
      model: undefined,
      sessionManager: {
        getSessionId: () => "session-456",
        getSessionFile: () => undefined,
      },
    });

    const record = buildSystemPromptRecord(event, ctx);

    expect(record.sessionId).toBe("session-456");
    expect(record.sessionFile).toBeUndefined();
    expect(record.provider).toBeUndefined();
    expect(record.modelId).toBeUndefined();
    expect(record.selectedTools).toBeUndefined();
    expect(record.skillNames).toBeUndefined();
    expect(record.contextFilePaths).toBeUndefined();
  });

  it("defaults capturedAt to the current time when no clock is injected", () => {
    const before = Date.now();
    const record = buildSystemPromptRecord({ systemPrompt: "x" }, fakeCtx());
    const after = Date.now();

    const capturedMs = new Date(record.capturedAt).getTime();
    expect(capturedMs).toBeGreaterThanOrEqual(before);
    expect(capturedMs).toBeLessThanOrEqual(after);
  });
});
