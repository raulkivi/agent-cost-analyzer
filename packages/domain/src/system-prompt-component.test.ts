// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { systemPromptComponentSchema } from "./system-prompt-component.js";

describe("systemPromptComponentSchema", () => {
  it("accepts a known system prompt component", () => {
    const sample = {
      kind: "repo-instructions",
      label: "copilot-instructions.md",
      tokenCount: { known: true, value: 340 },
    };

    expect(systemPromptComponentSchema.parse(sample)).toEqual(sample);
  });

  it("rejects an invalid kind", () => {
    const sample = {
      kind: "not-a-real-kind",
      label: "copilot-instructions.md",
      tokenCount: { known: true, value: 340 },
    };

    expect(() => systemPromptComponentSchema.parse(sample)).toThrow();
  });
});
