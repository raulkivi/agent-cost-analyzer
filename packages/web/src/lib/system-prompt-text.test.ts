import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystemPrompt } from "./system-prompt-parser.js";
import { assignTextColors } from "./system-prompt-menu.js";
import { buildTextSegments, flattenText } from "./system-prompt-text.js";

function build(text: string) {
  const { root } = parseSystemPrompt(text);
  const colors = assignTextColors(root);
  return buildTextSegments(root, text, colors);
}

describe("buildTextSegments", () => {
  it("wraps a single top-level tag's markup and content as one colored node segment", () => {
    const text = "<foo>hello world</foo>";

    const segments = build(text);

    expect(segments).toHaveLength(1);
    const [node] = segments;
    expect(node.kind).toBe("node");
    if (node.kind !== "node") throw new Error("unreachable");
    expect(node.children.map((s) => (s.kind === "text" ? s.text : null))).toEqual([
      "<foo>",
      "hello world",
      "</foo>",
    ]);
  });

  it("nests tag segments to match the parsed tree", () => {
    const text = "<outer><inner>x</inner></outer>";

    const segments = build(text);

    const outer = segments[0];
    if (outer.kind !== "node") throw new Error("unreachable");
    const inner = outer.children.find((s) => s.kind === "node");
    expect(inner).toBeDefined();
  });

  it("renders a node deeper than the menu depth cap as one flat, unwrapped text run", () => {
    const text = "<skills><skill><name><nested>x</nested></name></skill></skills>";

    const segments = build(text);

    // skills > skill > name are colored nodes (depth 1-3); name's child
    // "nested" (depth 4) must not appear as its own "node" segment.
    const skills = segments[0];
    if (skills.kind !== "node") throw new Error("unreachable");
    const skill = skills.children.find((s) => s.kind === "node");
    if (!skill || skill.kind !== "node") throw new Error("unreachable");
    const name = skill.children.find((s) => s.kind === "node");
    if (!name || name.kind !== "node") throw new Error("unreachable");
    expect(name.children.every((s) => s.kind === "text")).toBe(true);
    expect(flattenText(name.children)).toBe("<name><nested>x</nested></name>");
  });

  it("keeps whitespace-only gaps between siblings as plain text, not a colored node", () => {
    const text = "<a>1</a>\n\n<b>2</b>";

    const segments = build(text);

    expect(segments.map((s) => s.kind)).toEqual(["node", "text", "node"]);
  });

  it("round-trips to the exact original text for a simple case", () => {
    const text = "before\n<a>1</a>\n\n<b><c>2</c></b>\nafter";

    const segments = build(text);

    expect(flattenText(segments)).toBe(text);
  });

  it("uses a faint, uniform text-background tint over the theme's own ground rather than the nav swatch's full-saturation hue", () => {
    const text = "<foo>hello world</foo>";

    const [node] = build(text);

    if (node.kind !== "node") throw new Error("unreachable");
    expect(node.color).toMatch(/^color-mix\(in srgb, #2a78d6 16%, transparent\)$/);
  });
});

describe("buildTextSegments against a full-size synthetic prompt", () => {
  const fixturePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../fixtures/system-prompt-sample.txt",
  );
  const text = readFileSync(fixturePath, "utf-8");

  it("round-trips to the exact original text", () => {
    const segments = build(text);

    expect(flattenText(segments)).toBe(text);
  });
});
