import { describe, expect, it } from "vitest";
import { parseSystemPrompt } from "./system-prompt-parser.js";
import {
  assignIcicleColors,
  assignTextColors,
  buildMenu,
  CATEGORICAL_PALETTE,
  NEUTRAL_COLOR,
} from "./system-prompt-menu.js";
import { contrastRatio, parseColor, readableTextOn, resolveCssColor } from "./contrast.js";

describe("buildMenu labels", () => {
  it("labels a repeated container's child using its own <name> content", () => {
    const text = "<skills><skill><name>graphify</name><description>d</description></skill></skills>";
    const { root, malformed } = parseSystemPrompt(text);

    const entries = buildMenu(root, malformed, text);

    const skill = entries.find((entry) => entry.node.tagName === "skill");
    expect(skill?.label).toBe("graphify");
  });

  it("labels an attachment using the basename of its filePath attribute and exposes the full path", () => {
    const text = '<attachment filePath="/home/user/repo/CLAUDE.md">content</attachment>';
    const { root, malformed } = parseSystemPrompt(text);

    const entries = buildMenu(root, malformed, text);

    const attachment = entries.find((entry) => entry.node.tagName === "attachment");
    expect(attachment?.label).toBe("CLAUDE.md");
    expect(attachment?.fullPath).toBe("/home/user/repo/CLAUDE.md");
  });

  it("labels an instruction using its child <file> content", () => {
    const text = "<instruction><file>rules.instructions.md</file></instruction>";
    const { root, malformed } = parseSystemPrompt(text);

    const entries = buildMenu(root, malformed, text);

    expect(entries[0].label).toBe("rules.instructions.md");
  });

  it("formats a plain tag name into Title Case when no better label is available", () => {
    const text = "<semantic_search_requirements>x</semantic_search_requirements><toolUseInstructions>y</toolUseInstructions>";
    const { root, malformed } = parseSystemPrompt(text);

    const entries = buildMenu(root, malformed, text);

    expect(entries.map((entry) => entry.label)).toEqual(["Semantic Search Requirements", "Tool Use Instructions"]);
  });

  it("disambiguates repeated root-level tags sharing the same tag name with an incrementing suffix", () => {
    const text = "<instructions>a</instructions><instructions>b</instructions>";
    const { root, malformed } = parseSystemPrompt(text);

    const entries = buildMenu(root, malformed, text);

    expect(entries.map((entry) => entry.label)).toEqual(["Instructions", "Instructions (2)"]);
  });

  it("labels the first untagged root child Preamble and the last Trailing content", () => {
    const text = "intro\n<section>x</section>\ntail text";
    const { root, malformed } = parseSystemPrompt(text);

    const entries = buildMenu(root, malformed, text);

    expect(entries.map((entry) => entry.label)).toEqual(["Preamble", "Section", "Trailing content"]);
  });

  it("labels the single fallback node as unparsed when the input was malformed", () => {
    // "a" is structural (has a genuine pair) but its second occurrence
    // never closes — a real malformation, not filtered-out noise.
    const text = "<a>x</a><a>never closes";
    const { root, malformed } = parseSystemPrompt(text);
    expect(malformed).toBe(true);

    const entries = buildMenu(root, malformed, text);

    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("Full system prompt (unparsed)");
  });

  it("excludes nodes deeper than the menu depth cap", () => {
    const text = "<skills><skill><name><nested>x</nested></name></skill></skills>";
    const { root, malformed } = parseSystemPrompt(text);

    const entries = buildMenu(root, malformed, text);

    // skills(1) > skill(2) > name(3) are all in range; name's own child
    // "nested" (depth 4) never gets a menu entry of its own.
    expect(entries.map((entry) => entry.node.depth)).toEqual([1, 2, 3]);
    expect(entries.map((entry) => entry.node.tagName)).toEqual(["skills", "skill", "name"]);
  });
});

describe("buildMenu colors", () => {
  it("assigns the same color to same-tag-name root siblings", () => {
    const text = "<instructions>a</instructions><instructions>b</instructions>";
    const { root, malformed } = parseSystemPrompt(text);

    const entries = buildMenu(root, malformed, text);

    expect(entries[0].color).toBe(entries[1].color);
    expect(CATEGORICAL_PALETTE).toContain(entries[0].color);
  });

  it("cycles through the 8-hue categorical palette in order of first appearance, wrapping after 8 distinct families", () => {
    const tags = Array.from({ length: 9 }, (_, i) => `tag${i}`);
    const text = tags.map((tag) => `<${tag}>x</${tag}>`).join("\n");
    const { root, malformed } = parseSystemPrompt(text);

    const entries = buildMenu(root, malformed, text);

    expect(entries.map((entry) => entry.color)).toEqual([...CATEGORICAL_PALETTE, CATEGORICAL_PALETTE[0]]);
  });

  it("tints depth-2/3 children with a lighter color-mix of their depth-1 ancestor's hue", () => {
    const text = "<outer><inner><leaf>x</leaf></inner></outer>";
    const { root, malformed } = parseSystemPrompt(text);

    const entries = buildMenu(root, malformed, text);

    const outer = entries.find((e) => e.node.tagName === "outer")!;
    const inner = entries.find((e) => e.node.tagName === "inner")!;
    const leaf = entries.find((e) => e.node.tagName === "leaf")!;
    expect(outer.color).toBe(CATEGORICAL_PALETTE[0]);
    expect(inner.color).toMatch(/^color-mix\(in srgb, #2a78d6 \d+%, white\)$/);
    expect(leaf.color).toMatch(/^color-mix\(in srgb, #2a78d6 \d+%, white\)$/);
    expect(inner.color).not.toBe(leaf.color);
  });

  it("assigns the neutral color to untagged preamble/trailing nodes, outside the categorical cycle", () => {
    const text = "intro\n<a>x</a>";
    const { root, malformed } = parseSystemPrompt(text);

    const entries = buildMenu(root, malformed, text);

    expect(entries[0].color).toBe(NEUTRAL_COLOR);
    expect(entries[1].color).toBe(CATEGORICAL_PALETTE[0]);
  });
});

describe("assignTextColors", () => {
  it("tints a tagged node's own hue at 16% over the theme's own ground, uniformly regardless of nesting depth", () => {
    const text = "<outer><inner><leaf>x</leaf></inner></outer>";
    const { root } = parseSystemPrompt(text);

    const colors = assignTextColors(root);

    const [outer] = root.children;
    const [inner] = outer.children;
    const [leaf] = inner.children;
    expect(colors.get(outer.id)).toBe(`color-mix(in srgb, ${CATEGORICAL_PALETTE[0]} 16%, transparent)`);
    expect(colors.get(inner.id)).toBe(`color-mix(in srgb, ${CATEGORICAL_PALETTE[0]} 16%, transparent)`);
    expect(colors.get(leaf.id)).toBe(`color-mix(in srgb, ${CATEGORICAL_PALETTE[0]} 16%, transparent)`);
  });

  it("tints untagged preamble/trailing nodes at 12% of the neutral color over the theme's own ground", () => {
    const text = "intro\n<a>x</a>";
    const { root } = parseSystemPrompt(text);

    const colors = assignTextColors(root);

    const [preamble] = root.children;
    expect(colors.get(preamble.id)).toBe(`color-mix(in srgb, ${NEUTRAL_COLOR} 12%, transparent)`);
  });

  it("never returns a full-saturation (untinted) color, unlike the nav swatch scheme", () => {
    const text = "<a>x</a>";
    const { root } = parseSystemPrompt(text);

    const colors = assignTextColors(root);

    expect(colors.get(root.children[0].id)).not.toBe(CATEGORICAL_PALETTE[0]);
  });

  it("never mixes with white, which glares on a dark theme behind its light text", () => {
    const { root } = parseSystemPrompt("intro\n<a><b>x</b></a>");

    for (const color of assignTextColors(root).values()) expect(color).not.toMatch(/white/);
  });
});

describe("assignIcicleColors", () => {
  it("assigns a color to nodes deeper than the menu's depth-3 cap", () => {
    const text = "<skills><skill><name><nested>x</nested></name></skill></skills>";
    const { root } = parseSystemPrompt(text);

    const colors = assignIcicleColors(root);

    const skills = root.children[0];
    const skill = skills.children[0];
    const name = skill.children[0];
    const nested = name.children[0];
    expect(nested.depth).toBe(4);
    expect(colors.get(nested.id)).toBeDefined();
  });

  it("reuses the depth-3 tint for depth 4+ instead of continuing to lighten toward white", () => {
    const text = "<skills><skill><name><nested>x</nested></name></skill></skills>";
    const { root } = parseSystemPrompt(text);

    const colors = assignIcicleColors(root);

    const skills = root.children[0];
    const skill = skills.children[0];
    const name = skill.children[0];
    const nested = name.children[0];
    expect(colors.get(nested.id)).toBe(colors.get(name.id));
  });

  it("keeps the same hue family as the shallower ancestor sharing its tag name", () => {
    const text = "<skills><skill><name>graphify</name></skill></skills>";
    const { root } = parseSystemPrompt(text);

    const colors = assignIcicleColors(root);

    const skills = root.children[0];
    expect(colors.get(skills.id)).toBe(CATEGORICAL_PALETTE[0]);
  });
});

// §3.5: text on the inspector's colours stays at 4.5:1 or more in every
// theme. The text-pane grounds are the hue mixed with transparent, so they
// sit on the theme's own editor background, and segment text keeps the
// theme's own text colour (VS Code's Dark Modern, Light Modern and High
// Contrast editor colours below).
describe("system prompt colour contrast", () => {
  const THEMES = [
    { name: "Dark Modern", editor: "#1f1f1f", text: "#cccccc" },
    { name: "Light Modern", editor: "#ffffff", text: "#3b3b3b" },
    { name: "High Contrast", editor: "#000000", text: "#ffffff" },
  ];
  const text = "intro<a><b><c>x</c></b></a><d>y</d><e>z</e><f>1</f><g>2</g><h>3</h><i>4</i><j>5</j><k>6</k>";
  const { root } = parseSystemPrompt(text);

  it.each(THEMES)("keeps the $name text colour at 4.5:1 on every text-pane ground", ({ editor, text: themeText }) => {
    expect(assignTextColors(root).size).toBeGreaterThan(CATEGORICAL_PALETTE.length);
    for (const ground of assignTextColors(root).values()) {
      const painted = resolveCssColor(ground, { backdrop: parseColor(editor) });
      expect(contrastRatio(parseColor(themeText), painted)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives every icicle fill, at every depth, a label colour at 4.5:1 or more", () => {
    const fills = [...assignIcicleColors(root).values(), ...CATEGORICAL_PALETTE, NEUTRAL_COLOR];
    for (const fill of fills) {
      expect(contrastRatio(parseColor(readableTextOn(fill)), resolveCssColor(fill))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
