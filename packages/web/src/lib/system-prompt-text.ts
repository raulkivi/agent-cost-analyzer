import type { PromptNode } from "./system-prompt-parser.js";
import { MAX_MENU_DEPTH, NEUTRAL_COLOR } from "./system-prompt-menu.js";

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "node"; nodeId: string; color: string; children: TextSegment[] };

function textSegment(text: string): TextSegment | null {
  return text.length > 0 ? { kind: "text", text } : null;
}

// Builds the raw text as a tree of segments mirroring the parsed tag tree,
// so the center panel can render it with per-section background colors
// while staying byte-for-byte identical to the captured text (verified by
// the round-trip tests) — never reformatted, never truncated.
function buildChildren(node: PromptNode, text: string, colors: Map<string, string>): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = node.contentStart;

  for (const child of node.children) {
    const gap = textSegment(text.slice(cursor, child.start));
    if (gap) segments.push(gap);

    if (child.depth <= MAX_MENU_DEPTH) {
      const inner = [
        textSegment(text.slice(child.start, child.contentStart)),
        ...buildChildren(child, text, colors),
        textSegment(text.slice(child.contentEnd, child.end)),
      ].filter((segment): segment is TextSegment => segment !== null);
      segments.push({
        kind: "node",
        nodeId: child.id,
        color: colors.get(child.id) ?? NEUTRAL_COLOR,
        children: inner,
      });
    } else {
      // Beyond the menu/color depth cap: render this node's whole span
      // verbatim, without recursing into its own children.
      const flat = textSegment(text.slice(child.start, child.end));
      if (flat) segments.push(flat);
    }

    cursor = child.end;
  }

  const trailing = textSegment(text.slice(cursor, node.contentEnd));
  if (trailing) segments.push(trailing);

  return segments;
}

export function buildTextSegments(root: PromptNode, text: string, colors: Map<string, string>): TextSegment[] {
  return buildChildren(root, text, colors);
}

export function flattenText(segments: TextSegment[]): string {
  return segments.map((segment) => (segment.kind === "text" ? segment.text : flattenText(segment.children))).join("");
}
