import { describe, expect, it } from "vitest";
import type { ClaudeCodeRawEntry } from "../../../data-sources/claude-code/claude-code-jsonl-reader.js";
import { calibrationCaptureSchema } from "./capture.js";
import { extractClaudeCodeCapture } from "./extract-claude-code-capture.js";

const assistant = (
  id: string,
  timestamp: string,
  usage: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): ClaudeCodeRawEntry => ({
  type: "assistant",
  uuid: `${id}-${timestamp}`,
  timestamp,
  message: {
    id,
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text: "SECRET TEXT" }],
    usage,
  },
  ...extra,
});
const usage = (read: number, write: number, output: number, oneHour = 0) => ({
  input_tokens: 2,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  output_tokens: output,
  cache_creation: {
    ephemeral_1h_input_tokens: oneHour,
    ephemeral_5m_input_tokens: write - oneHour,
  },
});

describe("extractClaudeCodeCapture", () => {
  const entries: ClaudeCodeRawEntry[] = [
    {
      type: "user",
      uuid: "u0",
      timestamp: "2026-11-01T10:00:00.000Z",
      message: { content: "PRIVATE PROMPT" },
    },
    // One response written as two lines (one per content block) sharing a message id.
    assistant("m1", "2026-11-01T10:00:05.000Z", usage(0, 5000, 100, 5000)),
    assistant("m1", "2026-11-01T10:00:06.000Z", usage(0, 5000, 100, 5000)),
    assistant("m2", "2026-11-01T10:03:05.000Z", usage(5000, 600, 50, 600)),
    // A sub-agent's request has its own prompt and must not be mixed in.
    assistant("side", "2026-11-01T10:03:30.000Z", usage(10, 10, 10), {
      isSidechain: true,
    }),
  ];

  it("keeps one request per response, drops sub-agent requests and measures gaps", () => {
    const capture = extractClaudeCodeCapture(entries, {
      id: "cc-1",
      modelId: "claude-sonnet-5.5",
    });
    expect(capture.requests).toHaveLength(2);
    expect(capture.requests[0]).toEqual({
      index: 0,
      gapMinutes: 0,
      recorded: {
        uncachedInput: 2,
        cacheRead: 0,
        cacheWrite: 0,
        extendedCacheWrite: 5000,
        output: 100,
      },
    });
    expect(capture.requests[1]!.gapMinutes).toBeCloseTo(3, 5);
    expect(capture.requests[1]!.recorded.cacheRead).toBe(5000);
  });

  it("produces a schema-valid capture with no text from the session", () => {
    const capture = extractClaudeCodeCapture(entries, {
      id: "cc-1",
      modelId: "claude-sonnet-5.5",
    });
    expect(() => calibrationCaptureSchema.parse(capture)).not.toThrow();
    expect(JSON.stringify(capture)).not.toMatch(/SECRET|PRIVATE/);
    expect(capture).toMatchObject({
      source: "claude-code",
      harness: "claude-code",
      vendorId: "anthropic",
    });
  });

  it("splits cache writes into 5-minute and 1-hour by the recorded breakdown", () => {
    const mixed = [
      assistant("a", "2026-11-01T10:00:00.000Z", usage(0, 1000, 10, 400)),
      assistant("b", "2026-11-01T10:01:00.000Z", usage(1000, 100, 10, 0)),
    ];
    const [first, second] = extractClaudeCodeCapture(mixed, {
      id: "x",
      modelId: "m",
    }).requests;
    expect(first!.recorded).toMatchObject({
      cacheWrite: 600,
      extendedCacheWrite: 400,
    });
    expect(second!.recorded).toMatchObject({
      cacheWrite: 100,
      extendedCacheWrite: 0,
    });
  });
});
