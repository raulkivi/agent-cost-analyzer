import { Fragment, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { fetchSystemPromptText } from "../api-client/sessions.js";
import { PromptCompositionIcicle } from "../charts/PromptCompositionIcicle.js";
import { describeTag } from "../lib/system-prompt-descriptions.js";
import { assignIcicleColors, assignTextColors, buildMenu } from "../lib/system-prompt-menu.js";
import type { MenuEntry } from "../lib/system-prompt-menu.js";
import { parseSystemPrompt } from "../lib/system-prompt-parser.js";
import type { PromptNode } from "../lib/system-prompt-parser.js";
import { buildPrettyTextSegments } from "../lib/system-prompt-pretty.js";
import { buildTextSegments } from "../lib/system-prompt-text.js";
import type { TextSegment } from "../lib/system-prompt-text.js";
import { Blueprint } from "./ui/Blueprint.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";
import { Tag } from "./ui/Tag.js";

interface SystemPromptInspectorProps {
  sessionId: string;
  sessionTitle?: string;
  model?: string;
  providerId?: string;
  onClose: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; text: string };

type PromptFormat = "pretty" | "raw" | "icicle";

const FORMAT_OPTIONS = [
  { value: "pretty", label: "Pretty" },
  { value: "raw", label: "Raw" },
  { value: "icicle", label: "Icicle" },
] as const;

// Structure nav indent: ~14px per depth (roughly 1 character advance in the
// 12px UI font) plus an 8px base offset. Built as a single `padding`
// shorthand (not a separate `paddingLeft`) because a later `padding`
// declaration in the same style object would silently reset paddingLeft to
// its shorthand default, flattening the tree visually — a real bug this
// structure avoids by construction.
function navButtonPadding(depth: number): string {
  const indent = (depth - 1) * 14 + 8;
  return `4px var(--space-2) 4px ${indent}px`;
}

function nodeDomId(id: string): string {
  return `prompt-node-${id}`;
}

function renderSegments(segments: TextSegment[], selectedNodeId: string | null): ReactNode {
  return segments.map((segment, index) => {
    if (segment.kind === "text") {
      return <Fragment key={index}>{segment.text}</Fragment>;
    }
    const isSelected = segment.nodeId === selectedNodeId;
    return (
      <span
        key={segment.nodeId}
        id={nodeDomId(segment.nodeId)}
        data-testid={nodeDomId(segment.nodeId)}
        style={{
          background: segment.color,
          outline: isSelected ? "2px solid var(--color-text)" : undefined,
          outlineOffset: isSelected ? "-2px" : undefined,
        }}
      >
        {renderSegments(segment.children, selectedNodeId)}
      </span>
    );
  });
}

export function SystemPromptInspector({
  sessionId,
  sessionTitle,
  model,
  providerId,
  onClose,
}: SystemPromptInspectorProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [format, setFormat] = useState<PromptFormat>("pretty");

  useEffect(() => {
    let canceled = false;
    setState({ status: "loading" });
    setSelectedId(null);
    fetchSystemPromptText(sessionId)
      .then((text) => {
        if (!canceled) setState({ status: "ready", text });
      })
      .catch(() => {
        if (!canceled) {
          setState({
            status: "error",
            message:
              providerId === "pi-agent"
                ? "No system prompt captured for this session — run `npm run configure` to optionally install pi's system-prompt capture extension, then start a new pi session and try again."
                : "No system prompt captured for this session — enable agentDebugLog.fileLogging.enabled and reload VS Code.",
          });
        }
      });
    return () => {
      canceled = true;
    };
  }, [sessionId, providerId]);

  const parsed = useMemo(
    () => (state.status === "ready" ? parseSystemPrompt(state.text) : null),
    [state],
  );
  const menu = useMemo(
    () => (parsed && state.status === "ready" ? buildMenu(parsed.root, parsed.malformed, state.text) : []),
    [parsed, state],
  );
  const segments = useMemo(() => {
    if (!parsed || state.status !== "ready" || format === "icicle") return [];
    const colors = assignTextColors(parsed.root);
    return format === "pretty"
      ? buildPrettyTextSegments(parsed.root, state.text, colors)
      : buildTextSegments(parsed.root, state.text, colors);
  }, [parsed, state, format]);

  const icicleColors = useMemo(() => (parsed ? assignIcicleColors(parsed.root) : new Map()), [parsed]);

  const selectedEntry: MenuEntry | undefined = menu.find((entry) => entry.node.id === selectedId);

  function selectNode(node: PromptNode): void {
    setSelectedId(node.id);
    document.getElementById(nodeDomId(node.id))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          ← Back to session
        </button>
        {sessionTitle && (
          <span className="text-muted" style={{ fontSize: 12 }}>
            {sessionTitle}
          </span>
        )}
        <h4 style={{ margin: 0 }}>System prompt inspector</h4>
        {model && <Tag variant="accent">{model}</Tag>}
      </div>

      {state.status === "loading" && <p className="text-muted">Loading system prompt…</p>}
      {state.status === "error" && <p className="text-muted">{state.message}</p>}

      {state.status === "ready" && parsed && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "280px 1fr 320px",
            gap: "var(--space-4)",
            alignItems: "start",
          }}
        >
          <Blueprint
            style={{ padding: "var(--space-3)", maxHeight: "70vh", overflow: "auto" }}
          >
            <div className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>
              Structure
            </div>
            <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {menu.map((entry) => (
                <button
                  key={entry.node.id}
                  type="button"
                  onClick={() => selectNode(entry.node)}
                  title={entry.fullPath}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: entry.node.id === selectedId ? "var(--color-surface)" : "transparent",
                    border: "none",
                    borderRadius: 0,
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 12,
                    textAlign: "left",
                    color: "var(--color-text)",
                    padding: navButtonPadding(entry.node.depth),
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ width: 8, height: 8, flexShrink: 0, background: entry.color }}
                  />
                  <span className="truncate">{entry.label}</span>
                </button>
              ))}
            </nav>
          </Blueprint>

          <Blueprint style={{ padding: "var(--space-3)", maxHeight: "70vh", overflow: "auto" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-2)",
                marginBottom: "var(--space-2)",
              }}
            >
              <div className="card-kicker">{format === "icicle" ? "Composition" : "Raw text"}</div>
              <SegmentedControl name="promptFormat" options={FORMAT_OPTIONS} value={format} onChange={setFormat} />
            </div>
            {format === "icicle" ? (
              <PromptCompositionIcicle
                root={parsed.root}
                text={state.text}
                malformed={parsed.malformed}
                colors={icicleColors}
                selectedId={selectedId}
                onSelect={selectNode}
              />
            ) : (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "monospace",
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                {renderSegments(segments, selectedId)}
              </pre>
            )}
          </Blueprint>

          <Blueprint style={{ padding: "var(--space-3)", maxHeight: "70vh", overflow: "auto" }}>
            <div className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>
              Component description
            </div>
            {!selectedEntry ? (
              <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
                Select a section on the left to see what it does.
              </p>
            ) : (
              (() => {
                const description = describeTag(selectedEntry.node.tagName, selectedEntry.node, selectedEntry.label);
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    <div className="card-title" style={{ fontSize: 15 }}>
                      {selectedEntry.label}
                    </div>
                    <p style={{ fontSize: 13, margin: 0 }}>{description.description}</p>
                    <span
                      className={`tag ${description.sourced ? "tag-accent" : "tag-outline"}`}
                      style={{ alignSelf: "flex-start" }}
                    >
                      {description.sourced ? "Sourced" : "Not independently sourced"}
                    </span>
                    {description.sourceUrls.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: "var(--space-4)", fontSize: 11 }}>
                        {description.sourceUrls.map((url) => (
                          <li key={url} className="text-muted">
                            {url}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()
            )}
          </Blueprint>
        </div>
      )}
    </div>
  );
}
