import type { PromptNode } from "./system-prompt-parser.js";

// Validated 8-hue categorical palette (dataviz skill's reference instance,
// light-mode column) — fixed order, never cycled within a single family of
// 8; a 9th distinct tag family wraps back to slot 1 rather than inventing a
// new hue, same rule a chart legend would follow.
export const CATEGORICAL_PALETTE = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
];

export const NEUTRAL_COLOR = "#7a7a7d"; // matches theme.css --color-neutral-600

// Menu/coloring stops at depth 3 (root tag > its subtag > that subtag's own
// entries, e.g. <skills> > <skill> > — matching the "tags and subtags"
// granularity a reader actually wants to navigate by. Anything deeper
// (a skill's own <name>/<description>/<file>) still renders as plain text
// within its depth-3 ancestor's colored block — see system-prompt-text.ts.
export const MAX_MENU_DEPTH = 3;

export interface MenuEntry {
  node: PromptNode;
  label: string;
  fullPath?: string;
  color: string;
}

function formatTagName(tagName: string): string {
  const spaced = tagName.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function findChild(node: PromptNode, tagName: string): PromptNode | undefined {
  return node.children.find((child) => child.tagName === tagName);
}

export interface NodeLabel {
  label: string;
  fullPath?: string;
}

// Shared by buildMenu and the composition icicle chart, so a node's label
// (and the "(2)"-style disambiguation of repeated sibling tag names) reads
// identically wherever it's shown. `labelCounts` is caller-owned so each
// walk (menu vs. chart) gets its own independent count.
export function labelForNode(
  node: PromptNode,
  parent: PromptNode,
  malformed: boolean,
  text: string,
  labelCounts: Map<string, number>,
): NodeLabel {
  if (node.tagName === null) {
    if (malformed) return { label: "Full system prompt (unparsed)" };
    if (parent.children[0] === node) return { label: "Preamble" };
    if (parent.children[parent.children.length - 1] === node) return { label: "Trailing content" };
    return { label: "Untagged text" };
  }

  const nameChild = findChild(node, "name");
  if (nameChild) return { label: text.slice(nameChild.contentStart, nameChild.contentEnd).trim() };

  if (node.attrs.filePath) {
    const segments = node.attrs.filePath.split("/");
    return { label: segments[segments.length - 1] || node.attrs.filePath, fullPath: node.attrs.filePath };
  }

  const fileChild = findChild(node, "file");
  if (fileChild) return { label: text.slice(fileChild.contentStart, fileChild.contentEnd).trim() };

  const key = `${parent.id}|${node.tagName}`;
  const count = (labelCounts.get(key) ?? 0) + 1;
  labelCounts.set(key, count);
  const base = formatTagName(node.tagName);
  return { label: count > 1 ? `${base} (${count})` : base };
}

interface HueAssignment {
  hue: string;
  tagged: boolean;
}

// One hue-family per node, assigned by walking depth-1 first: a new distinct
// tagName claims the next categorical slot (cycling); a repeated tagName
// (e.g. two root-level <instructions>) reuses its family's slot. Depth-2/3
// descendants inherit their depth-1 ancestor's hue. Shared by both color
// schemes below — the nav swatch dots and the raw/pretty text backgrounds —
// so a given tag family reads as the same hue everywhere, just tinted
// differently for each use.
function assignHues(root: PromptNode, maxDepth: number): Map<string, HueAssignment> {
  const hues = new Map<string, HueAssignment>();
  const hueByTagName = new Map<string, string>();
  let nextHueIndex = 0;

  function hueForDepth1(node: PromptNode): string {
    if (node.tagName === null) return NEUTRAL_COLOR;
    const existing = hueByTagName.get(node.tagName);
    if (existing) return existing;
    const hue = CATEGORICAL_PALETTE[nextHueIndex % CATEGORICAL_PALETTE.length];
    hueByTagName.set(node.tagName, hue);
    nextHueIndex += 1;
    return hue;
  }

  function walk(node: PromptNode, depth1Hue: string | null): void {
    for (const child of node.children) {
      if (child.depth > maxDepth) continue;
      const hue = child.depth === 1 ? hueForDepth1(child) : (depth1Hue ?? NEUTRAL_COLOR);
      hues.set(child.id, { hue, tagged: child.tagName !== null });
      walk(child, child.depth === 1 ? hue : depth1Hue);
    }
  }
  walk(root, null);
  return hues;
}

// Nav swatch-dot colors: depth-1 shows the full hue, depth-2/3 are
// progressively lightened via color-mix so nesting reads as "same family,
// more specific," not as an unrelated color. These swatches are small,
// standalone chips — full saturation is legible at that size.
function tintForDepth(hue: string, depth: number): string {
  if (depth <= 1 || hue === NEUTRAL_COLOR) return hue;
  const mixPercent = depth === 2 ? 62 : 38;
  return `color-mix(in srgb, ${hue} ${mixPercent}%, white)`;
}

export function assignColors(root: PromptNode): Map<string, string> {
  const hues = assignHues(root, MAX_MENU_DEPTH);
  const colors = new Map<string, string>();
  for (const [id, node] of allNodesById(root)) {
    const assignment = hues.get(id);
    if (assignment) colors.set(id, tintForDepth(assignment.hue, node.depth));
  }
  return colors;
}

// Same hue-family assignment as assignColors, but unbounded in depth — the
// composition icicle chart zooms past the menu's depth-3 cap, so it needs a
// color for every node, not just the ones the flat nav list shows. Depth 3's
// tint (38%) is reused for depth 4+ rather than continuing to lighten toward
// white, so a family stays legible arbitrarily deep instead of washing out.
export function assignIcicleColors(root: PromptNode): Map<string, string> {
  const hues = assignHues(root, Infinity);
  const colors = new Map<string, string>();
  for (const [id, node] of allNodesById(root)) {
    const assignment = hues.get(id);
    if (assignment) colors.set(id, tintForDepth(assignment.hue, Math.min(node.depth, MAX_MENU_DEPTH)));
  }
  return colors;
}

// Raw/pretty-print text-pane background colors: a light, uniform tint
// regardless of nesting depth — full-saturation hue directly behind 12px
// monospace body text reads poorly, so every block gets the same light
// treatment, just distinguishing tagged blocks (16%) from untagged
// preamble/trailing free text (12%).
export function assignTextColors(root: PromptNode): Map<string, string> {
  const hues = assignHues(root, MAX_MENU_DEPTH);
  const colors = new Map<string, string>();
  for (const [id, { hue, tagged }] of hues) {
    colors.set(id, `color-mix(in srgb, ${hue} ${tagged ? 16 : 12}%, white)`);
  }
  return colors;
}

function* allNodesById(node: PromptNode): Generator<[string, PromptNode]> {
  for (const child of node.children) {
    yield [child.id, child];
    yield* allNodesById(child);
  }
}

export function buildMenu(root: PromptNode, malformed: boolean, text: string): MenuEntry[] {
  const colors = assignColors(root);
  const entries: MenuEntry[] = [];
  const labelCounts = new Map<string, number>();

  function walk(node: PromptNode): void {
    for (const child of node.children) {
      if (child.depth > MAX_MENU_DEPTH) continue;
      const { label, fullPath } = labelForNode(child, node, malformed, text, labelCounts);
      entries.push({ node: child, label, fullPath, color: colors.get(child.id) ?? NEUTRAL_COLOR });
      walk(child);
    }
  }
  walk(root);
  return entries;
}
