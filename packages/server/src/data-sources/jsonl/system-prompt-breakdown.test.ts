import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readMainJsonlEnvelopes } from "./main-jsonl-reader.js";
import type { JsonlEnvelope } from "./main-jsonl-reader.js";
import {
  buildSystemPromptBreakdown,
  extractCustomInstructionFileNames,
  extractLoadedSkillNames,
  PROMPT_TOKEN_COUNT_UNAVAILABLE_REASON,
} from "./system-prompt-breakdown.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/jsonl",
);
const samplePath = path.join(fixturesDir, "system-prompt-breakdown-sample.jsonl");

describe("extractCustomInstructionFileNames", () => {
  it("dedupes the file names listed in the Custom Instructions event's details (real log template)", async () => {
    const envelopes = await readMainJsonlEnvelopes(samplePath);

    expect(extractCustomInstructionFileNames(envelopes)).toEqual([
      "CLAUDE.md",
      "copilot-instructions.md",
    ]);
  });

  it("returns an empty array when there is no Custom Instructions event", () => {
    expect(extractCustomInstructionFileNames([{ type: "session_start" }])).toEqual(
      [],
    );
  });

  it("returns an empty array when the details string doesn't match the expected template", () => {
    const envelopes: JsonlEnvelope[] = [
      {
        type: "generic",
        name: "Custom Instructions",
        attrs: { details: "an unrecognized future log format" },
      },
    ];

    expect(extractCustomInstructionFileNames(envelopes)).toEqual([]);
  });
});

describe("extractLoadedSkillNames", () => {
  it("extracts the skill names listed in the Skill Discovery event's details (real log template)", async () => {
    const envelopes = await readMainJsonlEnvelopes(samplePath);

    expect(extractLoadedSkillNames(envelopes)).toEqual([
      "graphify",
      "project-setup-info-local",
      "troubleshoot",
    ]);
  });

  it("returns an empty array when there is no Skill Discovery event", () => {
    expect(extractLoadedSkillNames([{ type: "session_start" }])).toEqual([]);
  });

  it("returns an empty array when the details string doesn't match the expected template", () => {
    const envelopes: JsonlEnvelope[] = [
      {
        type: "discovery",
        name: "Skill Discovery",
        attrs: { details: "an unrecognized future log format" },
      },
    ];

    expect(extractLoadedSkillNames(envelopes)).toEqual([]);
  });
});

describe("buildSystemPromptBreakdown", () => {
  it("builds one component per real, structurally-known source; built-in and tool-definitions carry an estimated token count, the rest stay unavailable (real log template)", async () => {
    const envelopes = await readMainJsonlEnvelopes(samplePath);
    const toolDefinitionsText = JSON.stringify([
      { type: "function", name: "read_file", description: "d", parameters: {} },
    ]);

    const components = buildSystemPromptBreakdown(
      envelopes,
      "You are an expert AI programming assistant.",
      4,
      toolDefinitionsText,
    );

    expect(components).toEqual([
      {
        kind: "built-in",
        label: "Base system prompt (43 characters)",
        tokenCount: { known: true, value: expect.any(Number), estimated: true },
      },
      {
        kind: "repo-instructions",
        label: "CLAUDE.md",
        tokenCount: { known: false, reason: PROMPT_TOKEN_COUNT_UNAVAILABLE_REASON },
      },
      {
        kind: "repo-instructions",
        label: "copilot-instructions.md",
        tokenCount: { known: false, reason: PROMPT_TOKEN_COUNT_UNAVAILABLE_REASON },
      },
      {
        kind: "skill-manifest",
        label: "graphify",
        tokenCount: { known: false, reason: PROMPT_TOKEN_COUNT_UNAVAILABLE_REASON },
      },
      {
        kind: "skill-manifest",
        label: "project-setup-info-local",
        tokenCount: { known: false, reason: PROMPT_TOKEN_COUNT_UNAVAILABLE_REASON },
      },
      {
        kind: "skill-manifest",
        label: "troubleshoot",
        tokenCount: { known: false, reason: PROMPT_TOKEN_COUNT_UNAVAILABLE_REASON },
      },
      {
        kind: "tool-definitions",
        label: "Tool definitions (4 tools)",
        tokenCount: { known: true, value: expect.any(Number), estimated: true },
      },
    ]);
  });

  it("omits the built-in and tool-definitions components when their source data is unavailable", () => {
    expect(buildSystemPromptBreakdown([], null, null, null)).toEqual([]);
  });

  it("leaves the tool-definitions token count unavailable when the tool count is known but the raw definitions text couldn't be read", () => {
    const components = buildSystemPromptBreakdown([], null, 4, null);

    expect(components).toEqual([
      {
        kind: "tool-definitions",
        label: "Tool definitions (4 tools)",
        tokenCount: { known: false, reason: PROMPT_TOKEN_COUNT_UNAVAILABLE_REASON },
      },
    ]);
  });
});
