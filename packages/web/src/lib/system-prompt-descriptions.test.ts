import { describe, expect, it } from "vitest";
import { parseSystemPrompt } from "./system-prompt-parser.js";
import { describeTag, TAG_DESCRIPTIONS } from "./system-prompt-descriptions.js";
import type { PromptNode } from "./system-prompt-parser.js";

function nodeFor(text: string): PromptNode {
  return parseSystemPrompt(text).root.children[0];
}

describe("describeTag", () => {
  it("returns a sourced description for a known tag", () => {
    const node = nodeFor("<securityRequirements>x</securityRequirements>");

    const result = describeTag("securityRequirements", node, "Security Requirements");

    expect(result.sourced).toBe(true);
    expect(result.description.toLowerCase()).toContain("owasp");
    expect(result.sourceUrls.length).toBeGreaterThan(0);
  });

  it("distinguishes the built-in core instructions from the custom-instructions envelope by structure", () => {
    const core = nodeFor("<instructions>You are an expert AI programming assistant.</instructions>");
    const envelope = nodeFor("<instructions><skills>x</skills></instructions>");

    const coreResult = describeTag("instructions", core, "Instructions");
    const envelopeResult = describeTag("instructions", envelope, "Instructions (2)");

    expect(coreResult.description).not.toBe(envelopeResult.description);
    expect(coreResult.description.toLowerCase()).toMatch(/identity|operating|core/);
    expect(envelopeResult.description.toLowerCase()).toMatch(/custom instructions|applyto/);
  });

  it("gives distinct honest descriptions for preamble, trailing, and unparsed pseudo-sections", () => {
    const node = nodeFor("untagged");

    const preamble = describeTag(null, node, "Preamble");
    const trailing = describeTag(null, node, "Trailing content");
    const unparsed = describeTag(null, node, "Full system prompt (unparsed)");

    expect(preamble.sourced).toBe(false);
    expect(trailing.sourced).toBe(false);
    expect(unparsed.sourced).toBe(false);
    expect(new Set([preamble.description, trailing.description, unparsed.description]).size).toBe(3);
    expect(unparsed.description.toLowerCase()).toContain("could not");
  });

  it("gives an honest fallback for a tag name outside the researched glossary, never fabricating detail", () => {
    const node = nodeFor("<someBrandNewTag>x</someBrandNewTag>");

    const result = describeTag("someBrandNewTag", node, "Some Brand New Tag");

    expect(result.sourced).toBe(false);
    expect(result.description.toLowerCase()).toContain("no description available");
    expect(result.sourceUrls).toEqual([]);
  });

  it("has a description for every direct-repeated leaf kind (skill, agent, instruction)", () => {
    for (const tagName of ["skill", "agent", "instruction"]) {
      const node = nodeFor(`<${tagName}>x</${tagName}>`);
      const result = describeTag(tagName, node, tagName);
      expect(result.description.length).toBeGreaterThan(0);
    }
  });

  it("every dictionary entry marked sourced carries at least one source URL", () => {
    for (const [tagName, entry] of Object.entries(TAG_DESCRIPTIONS)) {
      if (entry.sourced) {
        expect(entry.sourceUrls.length, `${tagName} claims sourced but has no sourceUrls`).toBeGreaterThan(0);
      }
    }
  });
});
