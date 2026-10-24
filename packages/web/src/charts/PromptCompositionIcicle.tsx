import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { HierarchyNode } from "d3-hierarchy";
import { hierarchy as d3Hierarchy } from "d3-hierarchy";
import { readableTextOn } from "../lib/contrast.js";
import { labelForNode, MAX_MENU_DEPTH, NEUTRAL_COLOR } from "../lib/system-prompt-menu.js";
import type { PromptNode } from "../lib/system-prompt-parser.js";
import type { ChartDataRow } from "./ChartDataTable.js";
import { ViewAsTable } from "./ViewAsTable.js";

const ROW_HEIGHT = 28;
// One row for the focused node itself plus up to 3 descendant levels —
// beyond that a row gets too thin to read, so deeper content stays folded
// into its ancestor's rect until the user zooms again.
const VISIBLE_LEVELS = 4;

// Share of the *current* focus, not the whole prompt — so the percentage
// re-normalizes to 100% of whatever's visible as the user zooms in, instead
// of shrinking toward 0% the deeper they go.
function formatShare(value: number, total: number): string {
  return `${total > 0 ? Math.round((value / total) * 100) : 0}%`;
}

interface PromptCompositionIcicleProps {
  root: PromptNode;
  text: string;
  malformed: boolean;
  colors: Map<string, string>;
  selectedId: string | null;
  onSelect: (node: PromptNode) => void;
}

// Every section, depth first, as the "View as table" rows: the section's
// whole span (nested sections included) and its share of the whole prompt.
function tableRows(root: PromptNode, text: string, malformed: boolean): ChartDataRow[] {
  const total = root.end - root.start;
  const labelCounts = new Map<string, number>();
  const rows: ChartDataRow[] = [];
  function walk(node: PromptNode, parent: PromptNode | null): void {
    const size = node.end - node.start;
    rows.push({
      key: node.id,
      header: parent ? labelForNode(node, parent, malformed, text, labelCounts).label : "Full prompt",
      cells: [String(node.depth), String(size), formatShare(size, total)],
    });
    for (const child of node.children) walk(child, node);
  }
  walk(root, null);
  return rows;
}

function findPath(node: PromptNode, id: string): PromptNode[] | null {
  if (node.id === id) return [node];
  for (const child of node.children) {
    const rest = findPath(child, id);
    if (rest) return [node, ...rest];
  }
  return null;
}

// A node's own textual real estate — its full span minus whatever its
// children already account for — so summing self-values back up a subtree
// reconstructs exactly the ancestor's own span, with no double-counting of
// nested content. Also the correct value for a node whose real children are
// hidden by the visible-depth cutoff (nothing subtracted, so its rect's
// width still reflects everything nested inside it).
function selfSpan(node: PromptNode): number {
  const own = node.end - node.start;
  const childrenSpan = node.children.reduce((sum, child) => sum + (child.end - child.start), 0);
  return Math.max(0, own - childrenSpan);
}

/**
 * Zoomable icicle diagram of a parsed system prompt's tag structure. Not
 * self-contained — `root`/`malformed` come from `parseSystemPrompt(text)`
 * and `colors` from `assignIcicleColors(root)`; build those first, then
 * pass their output straight through as props. Click a rect to zoom into
 * it (breadcrumb trail shows the way back out) and to call `onSelect` when
 * the node is within the shared selection depth cap.
 *
 * Rendered as plain flexbox rows, not SVG: each row's items use
 * `flexGrow` proportional to their size, so the browser fills all
 * available width itself — no JS measurement, no resize-driven re-render,
 * and label text always renders at its true size. Labels that overflow
 * their bar are clipped with the shared `.truncate` CSS class rather than
 * a hand-estimated character cut.
 *
 * Keyboard: the cells are one roving-tabindex tab stop. Left/Right (and
 * Home/End) move along a level, Down goes to a section's first child and
 * Up to its parent; Enter or Space does what a click does.
 */
export function PromptCompositionIcicle({
  root,
  text,
  malformed,
  colors,
  selectedId,
  onSelect,
}: PromptCompositionIcicleProps) {
  const [focusId, setFocusId] = useState(root.id);
  // The roving tab stop: the cell that has tabindex 0.
  const [activeId, setActiveId] = useState(root.id);
  const cells = useRef(new Map<string, HTMLElement>());
  // Zooming moves a cell to another row, which remounts it and drops the
  // keyboard focus; this puts the focus back on the cell that had it.
  const refocus = useRef(false);

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    cells.current.get(activeId)?.focus();
  }, [focusId, activeId]);

  const path = useMemo(() => findPath(root, focusId) ?? [root], [root, focusId]);
  const focusNode = path[path.length - 1];
  const focusParent = path.length > 1 ? path[path.length - 2] : null;

  const hierarchyRoot = useMemo(() => {
    return d3Hierarchy(focusNode, (node) =>
      node.depth - focusNode.depth < VISIBLE_LEVELS - 1 ? node.children : undefined,
    ).sum((node) => {
      const cutoff = node.depth - focusNode.depth >= VISIBLE_LEVELS - 1 && node.children.length > 0;
      return cutoff ? node.end - node.start : selfSpan(node);
    });
  }, [focusNode]);

  // Fresh every render, not memoized: it's a counter for duplicate sibling
  // names within a *single* pass over hierarchyRoot.descendants() below,
  // not state meant to persist — reusing it across renders (e.g. via
  // useMemo keyed on focusNode) would keep incrementing the same counts on
  // every re-render, however triggered, producing runaway "(N)" suffixes.
  const labelCounts = new Map<string, number>();

  function labelFor(node: HierarchyNode<PromptNode>): string {
    if (!node.parent) {
      return focusParent ? labelForNode(focusNode, focusParent, malformed, text, labelCounts).label : "Full prompt";
    }
    return labelForNode(node.data, node.parent.data, malformed, text, labelCounts).label;
  }

  function activate(node: PromptNode, isFocusRow: boolean): void {
    if (isFocusRow) {
      if (focusParent) setFocusId(focusParent.id);
    } else {
      setFocusId(node.id);
    }
    if (node.depth > 0 && node.depth <= MAX_MENU_DEPTH) onSelect(node);
  }

  function handleKeyDown(
    event: KeyboardEvent,
    node: HierarchyNode<PromptNode>,
    row: HierarchyNode<PromptNode>[],
  ): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      refocus.current = true;
      activate(node.data, !node.parent);
      return;
    }
    const column = row.indexOf(node);
    const moves: Record<string, HierarchyNode<PromptNode> | undefined> = {
      ArrowRight: row[column + 1],
      ArrowLeft: row[column - 1],
      Home: row[0],
      End: row[row.length - 1],
      ArrowDown: node.children?.find((child) => child.value),
      ArrowUp: node.parent ?? undefined,
    };
    if (event.key in moves) {
      event.preventDefault();
      const target = moves[event.key];
      if (target) cells.current.get(target.data.id)?.focus();
    }
  }

  if (!hierarchyRoot.value) {
    return <p className="text-muted">No composition data.</p>;
  }

  const rows: HierarchyNode<PromptNode>[][] = Array.from({ length: VISIBLE_LEVELS }, () => []);
  hierarchyRoot.descendants().forEach((node) => {
    if (!node.value) return;
    // node.depth is d3's own depth, already reset to 0 at hierarchyRoot —
    // NOT the raw PromptNode.depth field (the node's absolute depth in the
    // full original tree), so no relative subtraction is needed here.
    const rowIndex = node.depth;
    if (rowIndex < VISIBLE_LEVELS) rows[rowIndex].push(node);
  });

  // The tab stop falls back to the focused node's cell if the remembered
  // one is no longer drawn (after zooming, or a new prompt).
  const tabStopId = rows.some((row) => row.some((node) => node.data.id === activeId))
    ? activeId
    : hierarchyRoot.data.id;
  const table = {
    caption: "Prompt composition",
    rowHeader: "Section",
    columns: ["Level", "Characters", "Share of prompt"],
    rows: tableRows(root, text, malformed),
  };

  return (
    <ViewAsTable table={table}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        <nav aria-label="Composition breadcrumb" style={{ display: "flex", flexWrap: "wrap", gap: 4, fontSize: 12 }}>
          {path.map((node, index) => {
            const label =
              index === 0 ? "Full prompt" : labelForNode(node, path[index - 1], malformed, text, new Map()).label;
            const isCurrent = node.id === focusId;
            return (
              <span key={node.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {index > 0 && (
                  <span aria-hidden="true" className="text-muted">
                    ›
                  </span>
                )}
                {isCurrent ? (
                  <span
                    aria-current="location"
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--color-text)",
                    }}
                  >
                    {label}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setFocusId(node.id)}
                    className="btn-link"
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      font: "inherit",
                      fontSize: 12,
                      cursor: "pointer",
                      color: "var(--color-accent-text)",
                      fontWeight: 400,
                    }}
                  >
                    {label}
                  </button>
                )}
              </span>
            );
          })}
        </nav>

        <div
          role="group"
          aria-label="Prompt composition icicle diagram"
          style={{ display: "flex", flexDirection: "column" }}
        >
          {rows.map((row, rowIndex) => {
            if (row.length === 0) return null;
            return (
              <div key={rowIndex} style={{ display: "flex", width: "100%", height: ROW_HEIGHT }}>
                {row.map((node) => {
                  const isFocusRow = !node.parent;
                  const fill = colors.get(node.data.id) ?? NEUTRAL_COLOR;
                  // Black or white, whichever reads on this fill (§3.5): the
                  // theme's text colour doesn't, on mid-tone or dark-theme cells.
                  const labelColor = readableTextOn(fill);
                  const label = labelFor(node);
                  const isSelected = node.data.id === selectedId;
                  const value = node.value ?? 0;
                  return (
                    <div
                      key={node.data.id}
                      ref={(element) => {
                        if (element) cells.current.set(node.data.id, element);
                        else cells.current.delete(node.data.id);
                      }}
                      data-testid={`icicle-node-${node.data.id}`}
                      className="icicle-cell"
                      role="button"
                      tabIndex={node.data.id === tabStopId ? 0 : -1}
                      aria-pressed={isSelected}
                      aria-label={`${label}, ${value} chars, ${formatShare(value, hierarchyRoot.value ?? 0)}${isFocusRow && focusParent ? " (focused, activate to zoom out)" : ""}`}
                      title={`${label} — ${value} chars${isFocusRow ? " (focused — click to zoom out)" : ""}`}
                      onClick={() => activate(node.data, isFocusRow)}
                      onFocus={() => setActiveId(node.data.id)}
                      onKeyDown={(event) => handleKeyDown(event, node, row)}
                      style={{
                        flexGrow: value,
                        flexShrink: 0,
                        flexBasis: 0,
                        minWidth: 0,
                        boxSizing: "border-box",
                        background: fill,
                        borderWidth: isSelected ? 2 : 1,
                        borderStyle: "solid",
                        borderColor: isSelected ? "var(--color-text)" : "var(--color-surface)",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        padding: "0 4px",
                        transition: "flex-grow 200ms ease",
                      }}
                    >
                      <div
                        className="truncate"
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: labelColor,
                        }}
                      >
                        {label}
                      </div>
                      <div
                        className="truncate"
                        style={{
                          fontSize: 9,
                          fontWeight: 400,
                          color: labelColor,
                        }}
                      >
                        {`${value} chars · ${formatShare(value, hierarchyRoot.value ?? 0)}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </ViewAsTable>
  );
}
