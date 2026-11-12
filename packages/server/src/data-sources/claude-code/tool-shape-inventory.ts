// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { unavailableTokenCount, type TokenCount, type ToolInventoryEntry } from "@agent-cost-analyzer/domain";
import { estimateTokenCount } from "../jsonl/token-estimator.js";
import { buildToolInventory } from "../jsonl/tool-inventory.js";
import type { ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";

// Phase 16 SR2 (docs/plans/savings-report.md §15 d): Claude Code writes each
// distinct request shape once (`api-request-shape`, with `shape.tools`) and
// names it by `shapeHash` on every `api-request`. Only tool names, sizes and
// the deferred flag are read; no system prompt or description text is kept,
// only a token count over it.

const MAIN_THREAD_SOURCE_PREFIX = "repl_main_thread";

const SHAPE_ABSENT_REASON = "This tool is not in the request shape, so its definition size is unknown.";

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

// A deferred tool (`defer_loading`) is not sent in full, only its name, so it
// counts at name-only cost; a loaded tool counts its description plus input schema.
function definitionTokens(tool: Record<string, unknown>, name: string): TokenCount {
  if (tool.defer_loading === true) return estimateTokenCount(name);
  const description = typeof tool.description === "string" ? tool.description : "";
  const schema = tool.input_schema === undefined ? "" : JSON.stringify(tool.input_schema);
  return estimateTokenCount(description + schema);
}

// Tool name → estimated definition tokens, per shape hash (one request's tool list each).
export function toolDefinitionTokensByShape(entries: readonly ClaudeCodeRawEntry[]): Map<string, Map<string, TokenCount>> {
  const byShape = new Map<string, Map<string, TokenCount>>();
  for (const entry of entries) {
    if (entry.type !== "api-request-shape" || typeof entry.shapeHash !== "string") continue;
    const tools = recordOf(entry.shape)?.tools;
    if (!Array.isArray(tools)) continue;
    const byName = new Map<string, TokenCount>();
    for (const tool of tools) {
      const record = recordOf(tool);
      if (record && typeof record.name === "string") byName.set(record.name, definitionTokens(record, record.name));
    }
    byShape.set(entry.shapeHash, byName);
  }
  return byShape;
}

// The shape of the last main-thread request that names a recorded shape
// (every request when none is a main-thread one).
function lastShapeHash(entries: readonly ClaudeCodeRawEntry[], known: ReadonlyMap<string, unknown>): string | undefined {
  const requests = entries.filter(
    (entry): entry is ClaudeCodeRawEntry & { shapeHash: string } =>
      entry.type === "api-request" && typeof entry.shapeHash === "string" && known.has(entry.shapeHash),
  );
  const mainThread = requests.filter((entry) => typeof entry.querySource === "string" && entry.querySource.startsWith(MAIN_THREAD_SOURCE_PREFIX));
  return (mainThread.length > 0 ? mainThread : requests).at(-1)?.shapeHash;
}

// Undefined when the log holds no usable shape: no inventory is claimed
// rather than an empty one (constraint 6).
export function buildClaudeCodeToolInventory(
  entries: readonly ClaudeCodeRawEntry[],
  invokedNamesByTurn: string[][],
): ToolInventoryEntry[] | undefined {
  const byShape = toolDefinitionTokensByShape(entries);
  const hash = lastShapeHash(entries, byShape);
  const tokens = hash === undefined ? undefined : byShape.get(hash);
  if (!tokens) return undefined;
  const lookup = (name: string): TokenCount => tokens.get(name) ?? unavailableTokenCount(SHAPE_ABSENT_REASON);
  return buildToolInventory([...tokens.keys()], invokedNamesByTurn, lookup);
}
