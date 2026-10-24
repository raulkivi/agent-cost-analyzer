import { describe, expect, it } from "vitest";
import { FakeProvider } from "../../test-support/audit-fakes.js";
import { supportsSystemPromptText, type SystemPromptTextLookup } from "./system-prompt-text-reader.js";

describe("supportsSystemPromptText", () => {
  it("is false for a provider without the optional capability", () => {
    expect(supportsSystemPromptText(new FakeProvider("fake", []))).toBe(false);
  });

  it("is true for a provider that implements lookupSystemPromptText", () => {
    const provider = Object.assign(new FakeProvider("fake", []), {
      lookupSystemPromptText: async (): Promise<SystemPromptTextLookup> => ({ status: "not-captured" }),
    });

    expect(supportsSystemPromptText(provider)).toBe(true);
  });
});
