// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { sessionSchema } from "./session.js";

const usage = {
  uncachedInput: { known: true, value: 120 },
  cacheWrite: { known: true, value: 30 },
  cacheRead: { known: true, value: 30 },
  tool: { known: true, value: 15 },
  vision: { known: true, value: 0 },
  reasoning: { known: true, value: 0 },
  output: { known: true, value: 200 },
  costAiCredits: { known: true, value: 2.79598 },
  model: "gpt-4o",
};

const turn = {
  index: 0,
  userMessage: "hi",
  assistantResponse: "hello",
  toolCalls: [],
  usage,
  explanation: "greeting",
};

describe("sessionSchema", () => {
  it("accepts a minimal Learn-mode session with no Analyze-only fields", () => {
    const sample = {
      id: "learn-cache-write-read",
      mode: "learn",
      title: "Cache write then read",
      model: "gpt-4o",
      turns: [turn],
      turnCount: 1,
      costAiCredits: { known: true, value: 2.79598 },
      usageDataAvailable: false,
    };

    expect(sessionSchema.parse(sample)).toEqual(sample);
  });

  it("accepts a full Analyze-mode session with system prompt and tool inventory", () => {
    const sample = {
      id: "session-123",
      mode: "analyze",
      title: "Real session",
      model: "gpt-4o",
      turns: [turn],
      turnCount: 1,
      systemPrompt: [
        { kind: "built-in", label: "core instructions", tokenCount: { known: true, value: 500 } },
      ],
      toolInventory: [{ name: "read_file", loaded: true, invokedInTurns: [0] }],
      costAiCredits: { known: true, value: 2.79598 },
      usageDataAvailable: true,
    };

    expect(sessionSchema.parse(sample)).toEqual(sample);
  });

  it("accepts optional category (Learn) and startedAt (Analyze) fields", () => {
    const learnSample = {
      id: "learn-cache-write-read",
      mode: "learn",
      title: "Cache write then read",
      model: "gpt-4o",
      turns: [turn],
      turnCount: 1,
      costAiCredits: { known: true, value: 2.79598 },
      usageDataAvailable: false,
      category: "Prompt caching",
    };
    const analyzeSample = {
      id: "session-123",
      mode: "analyze",
      title: "Real session",
      model: "gpt-4o",
      turns: [turn],
      turnCount: 1,
      costAiCredits: { known: true, value: 2.79598 },
      usageDataAvailable: true,
      startedAt: "2026-08-06T12:00:00.000Z",
    };

    expect(sessionSchema.parse(learnSample)).toEqual(learnSample);
    expect(sessionSchema.parse(analyzeSample)).toEqual(analyzeSample);
  });

  it("accepts turnCount independent of turns.length, as a session summary omits turn detail", () => {
    const sample = {
      id: "session-123",
      mode: "analyze",
      title: "Real session",
      model: "gpt-4o",
      turns: [],
      turnCount: 12,
      costAiCredits: { known: false, reason: "not extracted" },
      usageDataAvailable: false,
    };

    expect(sessionSchema.parse(sample)).toEqual(sample);
  });

  it("accepts a known or an unknown workspace (Phase 15 step 15.1)", () => {
    const base = {
      id: "session-123",
      mode: "analyze",
      title: "Real session",
      model: "gpt-4o",
      turns: [turn],
      turnCount: 1,
      costAiCredits: { known: true, value: 2.79598 },
      usageDataAvailable: true,
    };
    const known = { ...base, workspace: { known: true, cwd: "/home/dev/app", repositoryHint: "org/app", branch: "main" } };
    const unknown = { ...base, workspace: { known: false, reason: "no working folder recorded" } };

    expect(sessionSchema.parse(known)).toEqual(known);
    expect(sessionSchema.parse(unknown)).toEqual(unknown);
    expect(sessionSchema.safeParse({ ...base, workspace: { known: false } }).success).toBe(false);
  });

  it("accepts the capture file a mitmproxy session was read from (step 15.4)", () => {
    const base = {
      id: "har-1",
      mode: "analyze",
      title: "capture.har",
      model: "claude-sonnet-5",
      turns: [turn],
      turnCount: 1,
      costAiCredits: { known: false, reason: "n/a" },
      usageDataAvailable: true,
    };
    const sample = { ...base, capture: { filePath: "/home/dev/captures/acme/one.har" } };

    expect(sessionSchema.parse(sample)).toEqual(sample);
    expect(sessionSchema.safeParse({ ...base, capture: { filePath: "" } }).success).toBe(false);
  });

  it("accepts an Analyze-mode session with a providerId", () => {
    const sample = {
      id: "session-123",
      mode: "analyze",
      providerId: "mitmproxy",
      title: "Real session",
      model: "gpt-4o",
      turns: [turn],
      turnCount: 1,
      costAiCredits: { known: true, value: 2.79598 },
      usageDataAvailable: true,
    };

    expect(sessionSchema.parse(sample)).toEqual(sample);
  });

  it("accepts the Copilot harness a VS Code session came from", () => {
    const base = {
      id: "session-123",
      mode: "analyze",
      providerId: "vscode",
      title: "Real session",
      model: "gpt-4o",
      turns: [],
      turnCount: 0,
      costAiCredits: { known: false, reason: "n/a" },
      usageDataAvailable: false,
    };

    expect(sessionSchema.parse({ ...base, copilotHarness: "local" }).copilotHarness).toBe("local");
    expect(sessionSchema.parse({ ...base, copilotHarness: "agent-host" }).copilotHarness).toBe("agent-host");
    expect(() => sessionSchema.parse({ ...base, copilotHarness: "cloud" })).toThrow();
  });

  it("accepts whether an Agent Host session's Copilot CLI event log was read, with a reason when it wasn't", () => {
    const base = {
      id: "session-123",
      mode: "analyze",
      providerId: "vscode",
      title: "Real session",
      model: "gpt-4o",
      turns: [],
      turnCount: 0,
      costAiCredits: { known: false, reason: "n/a" },
      usageDataAvailable: false,
      copilotHarness: "agent-host",
    };

    for (const copilotEventLog of [
      { status: "read" },
      { status: "missing", reason: "no log" },
      { status: "unreadable", reason: "EACCES" },
    ]) {
      expect(sessionSchema.parse({ ...base, copilotEventLog }).copilotEventLog).toEqual(copilotEventLog);
    }
    expect(() => sessionSchema.parse({ ...base, copilotEventLog: { status: "missing" } })).toThrow();
    expect(() => sessionSchema.parse({ ...base, copilotEventLog: { status: "partial", reason: "x" } })).toThrow();
  });

  it("rejects an invalid mode", () => {
    const sample = {
      id: "session-123",
      mode: "not-a-real-mode",
      title: "Real session",
      model: "gpt-4o",
      turns: [],
      costAiCredits: { known: false, reason: "not extracted" },
      usageDataAvailable: true,
    };

    expect(() => sessionSchema.parse(sample)).toThrow();
  });
});
