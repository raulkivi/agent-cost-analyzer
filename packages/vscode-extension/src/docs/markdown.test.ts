import { describe, expect, it } from "vitest";
import { githubSlug, headingAnchors, isAbsoluteUrl, markdownLinks, splitTarget } from "./markdown.js";

// GitHub's heading ids (github-slugger over the rendered heading text):
// lowercase, drop punctuation other than "-" and "_", each space a "-".
describe("githubSlug", () => {
  it.each([
    ["Getting started", "getting-started"],
    ["Querying the audit from Claude Code (MCP)", "querying-the-audit-from-claude-code-mcp"],
    ["Enabling richer cache-write/reasoning numbers (optional)", "enabling-richer-cache-writereasoning-numbers-optional"],
    ["6.2.5 pi-agent provider flow", "625-pi-agent-provider-flow"],
    ["Rounds & caching", "rounds--caching"],
    ["snake_case stays", "snake_case-stays"],
    ["Ünïcode letters", "ünïcode-letters"],
    ["What's new?", "whats-new"],
  ])("%s → %s", (text, slug) => {
    expect(githubSlug(text)).toBe(slug);
  });
});

describe("headingAnchors", () => {
  it("slugs ATX headings from their rendered text", () => {
    const anchors = headingAnchors(
      ["# Title", "## The `aiCreditsAnalyzer.mcp.enabled` setting", "### [Linked](x.md) and **bold** ##", "#### _Emphasis_ here"].join("\n"),
    );

    expect([...anchors]).toEqual(["title", "the-aicreditsanalyzermcpenabled-setting", "linked-and-bold", "emphasis-here"]);
  });

  it("numbers repeated headings the way GitHub does", () => {
    expect([...headingAnchors("## Steps\n## Steps\n## Steps")]).toEqual(["steps", "steps-1", "steps-2"]);
  });

  it("ignores headings inside fenced code blocks", () => {
    expect([...headingAnchors("```bash\n# a comment\n```\n~~~\n# another\n~~~\n## Real")]).toEqual(["real"]);
  });

  it("includes explicit HTML anchors", () => {
    expect(headingAnchors('<a id="custom"></a>\n<a name="other"></a>')).toEqual(new Set(["custom", "other"]));
  });

  it("needs a space after the hashes and at most six of them", () => {
    expect([...headingAnchors("#nope\n####### nope\n###### yes")]).toEqual(["yes"]);
  });
});

describe("markdownLinks", () => {
  it("finds inline links and images with their line numbers", () => {
    expect(markdownLinks('See [the guide](docs/guide.md#install "Title").\n\n![Alt text](images/a.png)')).toEqual([
      { target: "docs/guide.md#install", image: false, line: 1 },
      { target: "images/a.png", image: true, line: 3 },
    ]);
  });

  it("finds an image nested inside a link", () => {
    expect(markdownLinks("[![badge](https://img.example/b.png)](https://example.com)")).toEqual([
      { target: "https://example.com", image: false, line: 1 },
      { target: "https://img.example/b.png", image: true, line: 1 },
    ]);
  });

  it("finds reference definitions, angle-bracket targets and HTML links and images", () => {
    expect(
      markdownLinks('[ref]: ../README.md\n[x](<a b.md>)\n<img src="https://x.test/i.png" alt="">\n<a href="#top">top</a>'),
    ).toEqual([
      { target: "../README.md", image: false, line: 1 },
      { target: "a b.md", image: false, line: 2 },
      { target: "https://x.test/i.png", image: true, line: 3 },
      { target: "#top", image: false, line: 4 },
    ]);
  });

  it("skips fenced code blocks and inline code", () => {
    expect(markdownLinks("```md\n[a](nope.md)\n```\nUse `[b](nope.md)` or [c](yes.md)")).toEqual([
      { target: "yes.md", image: false, line: 4 },
    ]);
  });

  it("doesn't take HTML comments as links", () => {
    expect(markdownLinks("<!-- screenshot: panel-dark.png -->\n<!-- [a](nope.md) -->")).toEqual([]);
  });
});

describe("isAbsoluteUrl", () => {
  it.each([
    ["https://github.com/x", true],
    ["http://example.com", true],
    ["mailto:a@b.c", true],
    ["command:aiCreditsAnalyzer.open", true],
    ["docs/guide.md", false],
    ["../README.md#x", false],
    ["#anchor", false],
    ["C:/not-a-scheme", false],
  ])("%s → %s", (target, absolute) => {
    expect(isAbsoluteUrl(target)).toBe(absolute);
  });
});

describe("splitTarget", () => {
  it("splits a target into its path and anchor, decoding the path", () => {
    expect(splitTarget("docs/My%20Guide.md#install")).toEqual({ path: "docs/My Guide.md", anchor: "install" });
    expect(splitTarget("#top")).toEqual({ path: "", anchor: "top" });
    expect(splitTarget("a.md?plain=1")).toEqual({ path: "a.md", anchor: undefined });
  });
});
