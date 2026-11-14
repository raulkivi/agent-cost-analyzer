// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { PiSystemPromptState } from "./system-message-replay.js";
import {
  ADDED_BY_PI_EXTENSIONS_LABEL,
  buildCombinedSystemPrompt,
  PI_IN_FILE_PROMPT_NOTE,
} from "./system-prompt-combiner.js";
import type { PiSystemPromptSidecarRecord } from "./system-prompt-sidecar-reader.js";

function state(sections: Array<[string, string]>, baseContent = "", tools: PiSystemPromptState["tools"] = []): PiSystemPromptState {
  const secs = sections.map(([name, text]) => ({ name, text }));
  return {
    baseContent,
    sections: secs,
    text: [baseContent, ...secs.map((s) => s.text)].filter(Boolean).join("\n\n"),
    tools,
    declaredToolNames: tools.map((t) => t.name),
  };
}
function sidecar(systemPrompt: string): PiSystemPromptSidecarRecord {
  return { sessionId: "s", capturedAt: "2026-10-01T10:00:00.000Z", cwd: "/p", systemPrompt, systemPromptChars: systemPrompt.length };
}
const labels = (r: ReturnType<typeof buildCombinedSystemPrompt>) => r.components.map((c) => c.label);

describe("buildCombinedSystemPrompt", () => {
  it("takes text and size from the sidecar", () => {
    const sc = sidecar("PREAMBLE\n\nRULES\n\nEXTRA NOTE");
    const result = buildCombinedSystemPrompt(state([["preamble", "PREAMBLE"], ["rules", "RULES"]]), sc);
    expect(result.text).toBe(sc.systemPrompt);
    expect(result.parts.map((p) => p.text).join("")).toBe(sc.systemPrompt);
  });

  it("names pi's sections found in the sidecar and puts the rest under 'Added by pi extensions'", () => {
    const sc = sidecar("PREAMBLE\n\nRULES\n\nVM mounts: /work");
    const result = buildCombinedSystemPrompt(state([["preamble", "PREAMBLE"], ["rules", "RULES"]]), sc);
    expect(labels(result)).toEqual([
      'Prompt section "preamble" (8 characters)',
      'Prompt section "rules" (5 characters)',
      `${ADDED_BY_PI_EXTENSIONS_LABEL} (18 characters)`,
    ]);
    expect(result.parts.at(-1)?.text).toBe("\n\nVM mounts: /work");
  });

  it("keeps parts in sidecar order, with extension text in the middle", () => {
    const sc = sidecar("A1\n\nINSERTED\n\nB2");
    const result = buildCombinedSystemPrompt(state([["b", "B2"], ["a", "A1"]]), sc);
    expect(result.parts.map((p) => p.name ?? "added")).toEqual(["a", "added", "b"]);
    expect(result.parts.map((p) => p.text).join("")).toBe(sc.systemPrompt);
  });

  it("adds no extension part when only separators remain, and still sums to the total", () => {
    const sc = sidecar("A1\n\nB2");
    const result = buildCombinedSystemPrompt(state([["a", "A1"], ["b", "B2"]]), sc);
    expect(labels(result).some((l) => l.startsWith(ADDED_BY_PI_EXTENSIONS_LABEL))).toBe(false);
    expect(result.parts.map((p) => p.text.length).reduce((x, y) => x + y, 0)).toBe(sc.systemPromptChars);
  });

  it("puts a section that does not occur verbatim (mcp_servers) into the remainder", () => {
    const sc = sidecar("A1\n\nmcp: a,b (rewritten)");
    const result = buildCombinedSystemPrompt(state([["a", "A1"], ["mcp_servers", "mcp: a, b"]]), sc);
    expect(labels(result)).toEqual([
      'Prompt section "a" (2 characters)',
      `${ADDED_BY_PI_EXTENSIONS_LABEL} (${"\n\nmcp: a,b (rewritten)".length} characters)`,
    ]);
  });

  it("does not claim the same sidecar text twice for equal sections", () => {
    const sc = sidecar("SAME\n\nSAME");
    const result = buildCombinedSystemPrompt(state([["x", "SAME"], ["y", "SAME"]]), sc);
    expect(result.parts.map((p) => p.name)).toEqual(["x", "y"]);
  });

  it("makes the whole sidecar prompt the extension part when no section is found", () => {
    const sc = sidecar("totally different");
    const result = buildCombinedSystemPrompt(state([["a", "A1"]]), sc);
    expect(result.parts).toEqual([{ text: "totally different" }]);
  });

  it("estimates tokens over each part and every one is known", () => {
    const result = buildCombinedSystemPrompt(state([["a", "A1"]]), sidecar("A1\n\nmore"));
    for (const c of result.components) expect(c.tokenCount).toEqual(expect.objectContaining({ known: true, estimated: true }));
  });

  it("keeps the tool-definitions component from the in-file tool declarations", () => {
    const tools = [{ name: "read", description: "Read" }];
    const result = buildCombinedSystemPrompt(state([["a", "A1"]], "", tools), sidecar("A1"));
    expect(labels(result).at(-1)).toBe("Tool definitions (1 tools)");
  });

  it("matches the base content too", () => {
    const result = buildCombinedSystemPrompt(state([["a", "A1"]], "BASE"), sidecar("BASE\n\nA1"));
    expect(labels(result)[0]).toBe("Base system prompt (4 characters)");
  });
});

describe("PI_IN_FILE_PROMPT_NOTE", () => {
  it("says the in-file prompt omits extension additions and names the logger", () => {
    expect(PI_IN_FILE_PROMPT_NOTE).toMatch(/pi-system-prompt-logger/);
    expect(PI_IN_FILE_PROMPT_NOTE).toMatch(/extensions/);
  });
});
