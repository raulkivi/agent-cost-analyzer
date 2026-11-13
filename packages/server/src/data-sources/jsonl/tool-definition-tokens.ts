// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { unavailableTokenCount, type TokenCount } from "@agent-cost-analyzer/domain";
import { estimateTokenCount } from "./token-estimator.js";

// Phase 16 SR2 (docs/plans/savings-report.md §4 O1, D12): per-tool definition
// tokens from the local tokenizer over each tool's own JSON in the tools file.
// An estimate, labelled so; unknown with a reason when the file is missing or
// does not hold the tool, never 0 (architecture.md constraint 6).

export type ToolDefinitionTokenLookup = (toolName: string) => TokenCount;

export const TOOLS_FILE_UNREADABLE_REASON = "The tools file could not be read, so this tool's definition size is unknown.";
export const TOOL_NOT_IN_TOOLS_FILE_REASON = "This tool is not in the tools file, so its definition size is unknown.";

// One request's tool list. Exported for callers that count per request.
export function toolDefinitionTokensByName(definitions: readonly unknown[]): Map<string, TokenCount> {
  const byName = new Map<string, TokenCount>();
  for (const definition of definitions) {
    const name = typeof definition === "object" && definition !== null ? (definition as { name?: unknown }).name : undefined;
    if (typeof name === "string") byName.set(name, estimateTokenCount(JSON.stringify(definition)));
  }
  return byName;
}

export interface ToolDefinitionTokenReasons {
  unreadable: string;
  absent: string;
}

const TOOLS_FILE_REASONS: ToolDefinitionTokenReasons = { unreadable: TOOLS_FILE_UNREADABLE_REASON, absent: TOOL_NOT_IN_TOOLS_FILE_REASON };

// `definitions` is null when the source (a tools file by default) could not be read.
export function toolDefinitionTokenLookup(
  definitions: readonly unknown[] | null,
  reasons: ToolDefinitionTokenReasons = TOOLS_FILE_REASONS,
): ToolDefinitionTokenLookup {
  if (definitions === null) return () => unavailableTokenCount(reasons.unreadable);
  const byName = toolDefinitionTokensByName(definitions);
  return (name) => byName.get(name) ?? unavailableTokenCount(reasons.absent);
}
