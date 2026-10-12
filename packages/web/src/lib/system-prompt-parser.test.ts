import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSystemPrompt } from "./system-prompt-parser.js";

describe("parseSystemPrompt", () => {
  it("parses a single top-level tag with correct offsets", () => {
    const text = "<foo>hello world</foo>";

    const { root, malformed } = parseSystemPrompt(text);

    expect(malformed).toBe(false);
    expect(root.children).toHaveLength(1);
    const [foo] = root.children;
    expect(foo.tagName).toBe("foo");
    expect(foo.depth).toBe(1);
    expect(foo.start).toBe(0);
    expect(foo.contentStart).toBe(5);
    expect(foo.contentEnd).toBe(16);
    expect(foo.end).toBe(text.length);
    expect(text.slice(foo.contentStart, foo.contentEnd)).toBe("hello world");
  });

  it("parses nested tags with increasing depth", () => {
    const text = "<outer><inner>x</inner></outer>";

    const { root } = parseSystemPrompt(text);

    const outer = root.children[0];
    expect(outer.tagName).toBe("outer");
    expect(outer.depth).toBe(1);
    const inner = outer.children[0];
    expect(inner.tagName).toBe("inner");
    expect(inner.depth).toBe(2);
    expect(text.slice(inner.contentStart, inner.contentEnd)).toBe("x");
  });

  it("parses attributes off an opening tag", () => {
    const text = '<attachment filePath="a/b.md">content</attachment>';

    const { root } = parseSystemPrompt(text);

    expect(root.children[0].attrs).toEqual({ filePath: "a/b.md" });
  });

  it("inserts a pseudo text node for non-whitespace preamble before the first tag", () => {
    const text = "intro text\n<foo>x</foo>";

    const { root } = parseSystemPrompt(text);

    expect(root.children).toHaveLength(2);
    expect(root.children[0].tagName).toBeNull();
    expect(root.children[0].start).toBe(0);
    expect(root.children[0].end).toBe(text.indexOf("<foo>"));
    expect(root.children[1].tagName).toBe("foo");
  });

  it("inserts a pseudo text node for non-whitespace trailing content after the last tag", () => {
    const text = "<foo>x</foo>\ntrailing text";

    const { root } = parseSystemPrompt(text);

    expect(root.children).toHaveLength(2);
    expect(root.children[1].tagName).toBeNull();
    expect(root.children[1].start).toBe(text.indexOf("\ntrailing"));
    expect(root.children[1].end).toBe(text.length);
  });

  it("does not insert a pseudo node for a whitespace-only gap", () => {
    const text = "<a>1</a>\n\n<b>2</b>";

    const { root } = parseSystemPrompt(text);

    expect(root.children).toHaveLength(2);
    expect(root.children.map((node) => node.tagName)).toEqual(["a", "b"]);
  });

  it("assigns distinct, stable ids to repeated sibling tag names", () => {
    const text = "<skill>x</skill><skill>y</skill>";

    const { root } = parseSystemPrompt(text);

    const ids = root.children.map((node) => node.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("ignores angle-bracket text that never has a matching closing tag anywhere in the document", () => {
    // Real-world case: prose containing a literal placeholder like
    // "<your-model-id>" with no closing "</your-model-id>" anywhere —
    // must not be treated as a structural tag, and must not corrupt
    // the real tags around it.
    const text = "<attachment>see <your-model-id> for details</attachment>";

    const { root, malformed } = parseSystemPrompt(text);

    expect(malformed).toBe(false);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].tagName).toBe("attachment");
    expect(root.children[0].children).toHaveLength(0);
  });

  it("treats plain text with no tags at all as a single unparsed section, not malformed", () => {
    const text = "just plain prose, no tags here";

    const { root, malformed } = parseSystemPrompt(text);

    expect(malformed).toBe(false);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].tagName).toBeNull();
    expect(root.children[0].start).toBe(0);
    expect(root.children[0].end).toBe(text.length);
  });

  it("produces no children for whitespace-only input", () => {
    const { root, malformed } = parseSystemPrompt("   \n\t  ");

    expect(malformed).toBe(false);
    expect(root.children).toHaveLength(0);
  });

  it("falls back to a single unparsed section when a real (structural) tag is never closed", () => {
    // "foo" is structural — it has one genuine open/close pair — but its
    // second occurrence is never closed, a real error distinct from noise.
    const text = "<foo>a</foo>\n<foo>b never closes";

    const { root, malformed } = parseSystemPrompt(text);

    expect(malformed).toBe(true);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].tagName).toBeNull();
    expect(root.children[0].start).toBe(0);
    expect(root.children[0].end).toBe(text.length);
  });

  it("ignores an inline prose mention of a tag name that is also used as real markup elsewhere", () => {
    // Real-world case: "...use the exact value from the <file> element..."
    // mid-sentence, while <file>...</file> is genuinely used as markup
    // elsewhere in the same document — the mid-sentence one must not be
    // treated as an opening tag (it isn't at the start of a line).
    const text = "<a>\nsee the <file> element for details\n<file>real.md</file>\n</a>";

    const { root, malformed } = parseSystemPrompt(text);

    expect(malformed).toBe(false);
    const a = root.children[0];
    expect(a.tagName).toBe("a");
    expect(a.children).toHaveLength(1);
    expect(a.children[0].tagName).toBe("file");
    expect(text.slice(a.children[0].contentStart, a.children[0].contentEnd)).toBe("real.md");
  });

  it("falls back to a single unparsed section when closing tags cross instead of nesting", () => {
    const text = "<a><b></a></b>";

    const { root, malformed } = parseSystemPrompt(text);

    expect(malformed).toBe(true);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].tagName).toBeNull();
  });

  it("falls back when a real, multiply-used tag name is unbalanced in count", () => {
    // "skill" has both opens and closes somewhere in the document (so it's
    // not filtered as a stray placeholder), but there are 2 opens and only
    // 1 close — a genuine structural error, not a false positive.
    const text = "<skills><skill>a</skill><skill>b</skills>";

    const { root, malformed } = parseSystemPrompt(text);

    expect(malformed).toBe(true);
    expect(root.children).toHaveLength(1);
  });
});

describe("parseSystemPrompt against a full-size synthetic prompt", () => {
  const fixturePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../fixtures/system-prompt-sample.txt",
  );
  const text = readFileSync(fixturePath, "utf-8");

  it("parses cleanly (not malformed) despite the literal '<your-model-id>' placeholders", () => {
    const { malformed } = parseSystemPrompt(text);

    expect(malformed).toBe(false);
  });

  it("finds every top-level section in document order", () => {
    const { root } = parseSystemPrompt(text);

    expect(root.children.map((node) => node.tagName)).toEqual([
      null, // preamble
      "instructions",
      "securityRequirements",
      "operationalSafety",
      "implementationDiscipline",
      "parallelizationStrategy",
      "toolUseInstructions",
      "communicationStyle",
      "notebookInstructions",
      "outputFormatting",
      "semantic_search_requirements",
      "memoryInstructions",
      "instructions",
      null, // trailing template-variables text
    ]);
  });

  it("nests skills, agents, and attachments inside the second top-level instructions wrapper", () => {
    const { root } = parseSystemPrompt(text);
    const secondInstructions = root.children[12];

    expect(secondInstructions.tagName).toBe("instructions");
    expect(secondInstructions.children.map((node) => node.tagName)).toEqual([
      "instructions",
      "skills",
      "agents",
      "attachment",
      "attachment",
      "attachment",
    ]);
  });

  it("finds 16 individual skill entries with correctly nested name/description/file children", () => {
    const { root } = parseSystemPrompt(text);
    const skills = root.children[12].children[1];

    expect(skills.tagName).toBe("skills");
    expect(skills.children).toHaveLength(16);
    const first = skills.children[0];
    expect(first.tagName).toBe("skill");
    expect(first.children.map((node) => node.tagName)).toEqual(["name", "description", "file"]);
  });
});
