import { describe, expect, it } from "vitest";
import { turnInspectorDetailSchema } from "./turn-inspector.js";

describe("turnInspectorDetailSchema", () => {
  it("accepts a multi-round turn detail with a text part and a placeholder part", () => {
    const sample = {
      turnIndex: 3,
      userMessage: [{ kind: "text", text: "Fix the flaky test." }],
      rounds: [
        {
          request: {
            index: 0,
            addedMessages: [{ kind: "text", text: "system: you are an agent" }],
            toolCalls: [
              {
                name: "read_file",
                args: [{ kind: "text", text: "src/foo.ts" }],
                result: [{ placeholder: true, kind: "file", path: "src/foo.ts", sizeBytes: 40000 }],
              },
            ],
          },
          response: {
            index: 0,
            response: [{ kind: "text", text: "I read the file." }],
            reasoning: [{ kind: "text", text: "Let me check the file first." }],
          },
        },
      ],
    };

    expect(turnInspectorDetailSchema.parse(sample)).toEqual(sample);
  });

  it("accepts a turn with zero rounds (no model request made)", () => {
    const sample = {
      turnIndex: 0,
      userMessage: [{ kind: "text", text: "hi" }],
      rounds: [],
    };

    expect(turnInspectorDetailSchema.parse(sample)).toEqual(sample);
  });

  it("accepts a response round with no reasoning field", () => {
    const sample = {
      turnIndex: 0,
      userMessage: [],
      rounds: [
        {
          request: { index: 0, addedMessages: [], toolCalls: [] },
          response: { index: 0, response: [{ kind: "text", text: "ok" }] },
        },
      ],
    };

    expect(turnInspectorDetailSchema.parse(sample)).toEqual(sample);
  });

  it("accepts an image placeholder with no path or sizeBytes", () => {
    const sample = {
      turnIndex: 0,
      userMessage: [{ placeholder: true, kind: "image" }],
      rounds: [],
    };

    expect(turnInspectorDetailSchema.parse(sample)).toEqual(sample);
  });

  it("rejects an unknown content-part kind", () => {
    const sample = {
      turnIndex: 0,
      userMessage: [{ kind: "audio", text: "nope" }],
      rounds: [],
    };

    expect(() => turnInspectorDetailSchema.parse(sample)).toThrow();
  });
});
