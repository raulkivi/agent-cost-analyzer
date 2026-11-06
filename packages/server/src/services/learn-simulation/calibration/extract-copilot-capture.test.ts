import { describe, expect, it } from "vitest";
import { calibrationCaptureSchema } from "./capture.js";
import {
  captureFromAgentHostEvents,
  captureFromCopilotRequests,
  type CopilotRequestUsage,
} from "./extract-copilot-capture.js";
import type { CopilotEvent } from "../../../data-sources/agent-host/copilot-event.js";

const MIN = 60_000;
const request = (
  overrides: Partial<CopilotRequestUsage> = {},
): CopilotRequestUsage => ({
  startedAtMs: 0,
  model: "claude-sonnet-5",
  inputTokens: 1000,
  cacheReadTokens: 0,
  cacheWriteTokens: null,
  outputTokens: 50,
  ...overrides,
});
const options = {
  id: "copilot-abc12345",
  source: "copilot-local" as const,
  harness: "vscode-local" as const,
  modelId: "claude-sonnet-5",
};

describe("captureFromCopilotRequests", () => {
  const capture = captureFromCopilotRequests(
    [
      request({ startedAtMs: 10 * MIN, inputTokens: 1000, cacheReadTokens: 0 }),
      request({
        startedAtMs: 10 * MIN + 30_000,
        inputTokens: 1300,
        cacheReadTokens: 999,
      }),
      request({ startedAtMs: 17 * MIN, inputTokens: 1500, cacheReadTokens: 0 }),
    ],
    options,
  );

  it("produces a schema-valid capture with one entry per request", () => {
    expect(() => calibrationCaptureSchema.parse(capture)).not.toThrow();
    expect(capture.requests.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("measures gaps in minutes between request starts, 0 for the first", () => {
    expect(capture.requests.map((r) => r.gapMinutes)).toEqual([0, 0.5, 6.5]);
  });

  it("records the billed split; without a write figure everything uncached-or-written is uncachedInput", () => {
    expect(capture.requests[1]!.recorded).toEqual({
      uncachedInput: 301,
      cacheRead: 999,
      cacheWrite: 0,
      output: 50,
    });
    expect(capture.notes).toMatch(/cache writes? (are|is) not recorded/i);
  });

  it("splits uncached input from cache writes when the write count is known", () => {
    const known = captureFromCopilotRequests(
      [
        request({ inputTokens: 1000, cacheWriteTokens: 600 }),
        request({
          startedAtMs: MIN,
          inputTokens: 1100,
          cacheReadTokens: 1000,
          cacheWriteTokens: 90,
        }),
      ],
      options,
    );
    expect(known.requests[0]!.recorded).toMatchObject({
      uncachedInput: 400,
      cacheWrite: 600,
    });
    expect(known.requests[1]!.recorded).toMatchObject({
      uncachedInput: 10,
      cacheRead: 1000,
      cacheWrite: 90,
    });
    expect(known.notes ?? "").not.toMatch(/not recorded/i);
  });

  it("keeps only the requested model's requests, in time order", () => {
    const mixed = captureFromCopilotRequests(
      [
        request({
          startedAtMs: 2 * MIN,
          inputTokens: 1200,
          cacheReadTokens: 1000,
        }),
        request({ startedAtMs: MIN, model: "gpt-4o-mini", inputTokens: 40 }),
        request({ startedAtMs: 0, inputTokens: 1000 }),
      ],
      { ...options, modelPrefix: "claude" },
    );
    expect(mixed.requests.map((r) => r.recorded.cacheRead)).toEqual([0, 1000]);
    expect(mixed.requests.map((r) => r.gapMinutes)).toEqual([0, 2]);
  });

  it("can keep just the first N requests", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      request({ startedAtMs: i * MIN, inputTokens: 1000 + i }),
    );
    expect(
      captureFromCopilotRequests(rows, { ...options, limit: 4 }).requests,
    ).toHaveLength(4);
  });

  it("refuses a cache read larger than the request's input", () => {
    expect(() =>
      captureFromCopilotRequests(
        [
          request(),
          request({ startedAtMs: MIN, inputTokens: 10, cacheReadTokens: 50 }),
        ],
        options,
      ),
    ).toThrow(/cache read/i);
  });

  it("carries no text: only the declared fields exist on a capture", () => {
    expect(Object.keys(capture).sort()).toEqual([
      "harness",
      "id",
      "modelId",
      "notes",
      "requests",
      "source",
      "vendorId",
    ]);
  });
});

describe("captureFromAgentHostEvents", () => {
  const usageEvent = (
    timestamp: string,
    usage: Record<string, unknown>,
    agentId: string | null = null,
  ): CopilotEvent => ({
    id: timestamp,
    type: "session.usage_record",
    parentId: null,
    timestamp,
    agentId,
    data: { usage },
  });
  const base = {
    model: "claude-sonnet-5",
    inputTokens: 1000,
    cacheReadTokens: 0,
    outputTokens: 20,
    cacheWriteTokens: 1000,
    cacheDetailsReported: true,
  };

  it("reads per-call usage records and drops sub-agent calls", () => {
    const capture = captureFromAgentHostEvents(
      [
        usageEvent("2026-11-01T10:00:00.000Z", base),
        usageEvent(
          "2026-11-01T10:00:20.000Z",
          { ...base, inputTokens: 50 },
          "sub-1",
        ),
        usageEvent("2026-11-01T10:01:00.000Z", {
          ...base,
          inputTokens: 1100,
          cacheReadTokens: 1000,
          cacheWriteTokens: 100,
        }),
      ],
      {
        ...options,
        source: "copilot-agent-host",
        harness: "copilot-agent-host",
      },
    );
    expect(capture.requests).toHaveLength(2);
    expect(capture.requests[1]).toMatchObject({
      gapMinutes: 1,
      recorded: { cacheRead: 1000, cacheWrite: 100, uncachedInput: 0 },
    });
  });

  it("treats a record whose cache details are unreliable as write-unknown", () => {
    const capture = captureFromAgentHostEvents(
      [
        usageEvent("2026-11-01T10:00:00.000Z", {
          ...base,
          cacheDetailsReported: false,
        }),
        usageEvent("2026-11-01T10:01:00.000Z", {
          ...base,
          inputTokens: 1100,
          cacheReadTokens: 1000,
          cacheDetailsReported: false,
        }),
      ],
      {
        ...options,
        source: "copilot-agent-host",
        harness: "copilot-agent-host",
      },
    );
    expect(capture.notes).toMatch(/not recorded/i);
    expect(capture.requests[1]!.recorded).toMatchObject({
      cacheWrite: 0,
      uncachedInput: 100,
    });
  });
});
