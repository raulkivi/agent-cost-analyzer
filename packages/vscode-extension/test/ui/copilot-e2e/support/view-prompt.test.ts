// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { viewsPrompt } from "./view-prompt.mts";

// One fixed prompt makes Copilot call every tool whose view a G4 spec reads,
// in one step (owner decision D8: few AI Credits per run).
describe("viewsPrompt", () => {
  const calls = [
    { tool: "get_repository_cost", args: { repository: "github.com/example/portal-web", bucket: "week" } },
    { tool: "get_project_cost", args: { projectId: "demo" } },
  ];

  it("lists each call in order with its exact arguments as JSON", () => {
    const prompt = viewsPrompt(calls);

    expect(prompt).toContain('1. get_repository_cost {"repository":"github.com/example/portal-web","bucket":"week"}');
    expect(prompt).toContain('2. get_project_cost {"projectId":"demo"}');
    expect(prompt.indexOf("1. get_repository_cost")).toBeLessThan(prompt.indexOf("2. get_project_cost"));
  });

  it("asks for every call at once, each once, on the analyzer's server, and a one-word reply", () => {
    const prompt = viewsPrompt(calls);

    expect(prompt).toMatch(/ai-credits-analyzer MCP tools/);
    expect(prompt).toMatch(/all 2 .* in parallel/i);
    expect(prompt).toMatch(/exactly once/);
    expect(prompt).toMatch(/reply with the single word: done$/);
  });

  it("refuses an empty list", () => {
    expect(() => viewsPrompt([])).toThrow(/at least one/);
  });
});
