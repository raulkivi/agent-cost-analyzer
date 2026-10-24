import type { PromptNode } from "./system-prompt-parser.js";
import type { TextSegment } from "./system-prompt-text.js";

const INDENT_UNIT = "  ";
// A leaf tag's content renders inline (<tag>value</tag>) only when it's a
// single short line — e.g. <name>chronicle</name>. Longer or multi-line
// leaf content (a pasted file, a paragraph) still opens/closes on its own
// line with the content indented beneath, same as a tag with child tags.
const INLINE_MAX_LENGTH = 60;

function attrsToString(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join("");
}

function canInline(content: string): boolean {
  return content.length <= INLINE_MAX_LENGTH && !content.includes("\n");
}

// Formats one tagged node as a TextSegment tree, reformatting whitespace
// around a 2-space-per-depth indent rather than preserving the captured
// text's original spacing — this is the pretty-printed view, so unlike
// buildTextSegments it does not round-trip to the original bytes.
function formatTagNode(node: PromptNode, text: string, colors: Map<string, string>, indent: string): TextSegment {
  const color = colors.get(node.id) ?? "transparent";
  const openTag = `<${node.tagName}${attrsToString(node.attrs)}>`;
  const closeTag = `</${node.tagName}>`;
  const elementChildren = node.children.filter((child) => child.tagName !== null);

  if (elementChildren.length === 0) {
    const content = text.slice(node.contentStart, node.contentEnd).trim();
    if (canInline(content)) {
      return { kind: "node", nodeId: node.id, color, children: [{ kind: "text", text: `${openTag}${content}${closeTag}` }] };
    }
    const childIndent = indent + INDENT_UNIT;
    const body = content ? `${openTag}\n${childIndent}${content}\n${indent}${closeTag}` : `${openTag}${closeTag}`;
    return { kind: "node", nodeId: node.id, color, children: [{ kind: "text", text: body }] };
  }

  const childIndent = indent + INDENT_UNIT;
  const inner: TextSegment[] = [{ kind: "text", text: `${openTag}\n` }];
  let cursor = node.contentStart;
  for (const child of elementChildren) {
    const gap = text.slice(cursor, child.start).trim();
    if (gap) inner.push({ kind: "text", text: `${childIndent}${gap}\n` });
    inner.push({ kind: "text", text: childIndent });
    inner.push(formatTagNode(child, text, colors, childIndent));
    inner.push({ kind: "text", text: "\n" });
    cursor = child.end;
  }
  const trailingGap = text.slice(cursor, node.contentEnd).trim();
  if (trailingGap) inner.push({ kind: "text", text: `${childIndent}${trailingGap}\n` });
  inner.push({ kind: "text", text: `${indent}${closeTag}` });
  return { kind: "node", nodeId: node.id, color, children: inner };
}

// Builds the pretty-printed counterpart to buildTextSegments: same colored,
// clickable node structure the nav relies on for scroll-to/highlight, but
// with 2-space indentation and re-flowed whitespace instead of a literal
// slice of the captured text.
export function buildPrettyTextSegments(root: PromptNode, text: string, colors: Map<string, string>): TextSegment[] {
  const segments: TextSegment[] = [];
  root.children.forEach((node, index) => {
    if (index > 0) segments.push({ kind: "text", text: "\n\n" });
    if (node.tagName === null) {
      const content = text.slice(node.start, node.end).trim();
      if (content) {
        segments.push({
          kind: "node",
          nodeId: node.id,
          color: colors.get(node.id) ?? "transparent",
          children: [{ kind: "text", text: content }],
        });
      }
      return;
    }
    segments.push(formatTagNode(node, text, colors, ""));
  });
  return segments;
}
