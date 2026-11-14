// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import { resolvePiSystemPrompt } from "./resolve-pi-system-prompt.js";
import { PI_IN_FILE_PROMPT_NOTE } from "./system-prompt-combiner.js";
import type { PiSystemPromptSidecarRecord } from "./system-prompt-sidecar-reader.js";

const systemEntry = (timestamp: string): PiRawEntry => ({
  type: "message",
  id: "s0",
  timestamp,
  message: { role: "system", content: "", sections: { rules: "RULES", cwd: "cwd: /p" } },
});
const userEntry = (timestamp: string): PiRawEntry => ({ type: "message", id: "u1", timestamp, message: { role: "user", content: "hi" } });

function sidecar(capturedAt: string, systemPrompt: string): PiSystemPromptSidecarRecord {
  return { sessionId: "s", capturedAt, cwd: "/p", systemPrompt, systemPromptChars: systemPrompt.length };
}

describe("resolvePiSystemPrompt", () => {
  const branch = [systemEntry("2026-10-01T10:00:00.000Z"), userEntry("2026-10-01T10:00:05.000Z")];

  it("combines the in-file sections with the matching sidecar record", () => {
    const result = resolvePiSystemPrompt(branch, [sidecar("2026-10-01T10:00:01.000Z", "RULES\n\ncwd: /p\n\nVM note")]);
    expect(result.text).toBe("RULES\n\ncwd: /p\n\nVM note");
    expect(result.components?.map((c) => c.label)).toContain("Added by pi extensions (9 characters)");
    expect(result.note).toBeUndefined();
  });

  it("picks the sidecar record that was current at the branch's end", () => {
    const result = resolvePiSystemPrompt(branch, [
      sidecar("2026-10-01T10:00:01.000Z", "RULES\n\ncwd: /p\n\nfirst"),
      sidecar("2026-10-01T11:00:00.000Z", "RULES\n\ncwd: /p\n\nlater"),
    ]);
    expect(result.text).toMatch(/first$/);
  });

  it("keeps the in-file prompt and adds the honest note when there is no sidecar record", () => {
    const result = resolvePiSystemPrompt(branch, undefined);
    expect(result.text).toBe("RULES\n\ncwd: /p");
    expect(result.note).toBe(PI_IN_FILE_PROMPT_NOTE);
    expect(result.components?.[0].label).toBe('Prompt section "rules" (5 characters)');
  });

  it("uses the sidecar alone, without a note, when the file has no system message", () => {
    const result = resolvePiSystemPrompt([userEntry("2026-10-01T10:00:05.000Z")], [sidecar("2026-10-01T10:00:01.000Z", "Exact")]);
    expect(result.text).toBe("Exact");
    expect(result.components?.[0].label).toBe("Base system prompt (5 characters)");
    expect(result.note).toBeUndefined();
    expect(result.state).toBeNull();
  });

  it("has nothing when neither source exists", () => {
    expect(resolvePiSystemPrompt([userEntry("2026-10-01T10:00:05.000Z")], undefined)).toEqual({
      text: null,
      components: undefined,
      note: undefined,
      state: null,
    });
  });
});
