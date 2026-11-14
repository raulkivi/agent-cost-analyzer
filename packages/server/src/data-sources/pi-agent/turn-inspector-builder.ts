// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TurnInspectorDetail } from "@agent-cost-analyzer/domain";
import { buildContentPart } from "../log-providers/build-content-parts.js";
import {
  assistantMessageOf,
  findToolCallBlock,
  messageOf,
  toolCallArgumentsOf,
  toolResultMessageOf,
  type PiAssistantMessage,
} from "./pi-message.js";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import type { PiTurnGroup } from "./turn-grouper.js";
import { contextEditFor, type PiContextEdit } from "./context-edits.js";

function isThinkingBlock(block: unknown): boolean {
  return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "thinking";
}

// A content block's own text field, when present, so the wrapping
// `{ type, ... }` envelope isn't stringified alongside the actual text:
// TextContent.text, ThinkingContent.thinking (docs/message-types.md);
// `content` is a tolerated fallback. Anything else (a toolCall block) is
// shown raw.
function blockText(block: unknown): unknown {
  if (typeof block === "object" && block !== null) {
    const withText = block as { text?: unknown; thinking?: unknown; content?: unknown };
    return withText.text ?? withText.thinking ?? withText.content ?? block;
  }
  return block;
}

// What an entry adds to the next request, or undefined when it adds nothing
// the model sees: a compaction or branch summary is sent as its summary text
// (docs/session-format.md "Context Building"); context_edit, model and
// thinking changes, usage, labels and other metadata produce no message.
function entryText(entry: PiRawEntry): unknown {
  const message = messageOf(entry);
  if (message) {
    return typeof message.content === "string" ? message.content : (message.content ?? message);
  }
  if ((entry.type === "compaction" || entry.type === "branch_summary") && typeof entry.summary === "string") {
    return entry.summary;
  }
  if (entry.type === "custom_message") {
    return entry.content;
  }
  return undefined;
}

// pi's JSONL entries are already incremental (each is only its own new
// content), unlike VS Code's main.jsonl where every round re-sends the
// entire cumulative conversation — so unlike turn-inspector-builder.ts's VS
// Code counterpart, no array-length diffing is needed here: one round per
// AssistantMessage, and "added since the previous round" is just the
// entries between the previous assistant message (exclusive) and this one.
// `contextEdits` (latestContextEdits over the whole branch) marks responses
// and tool results a later context_edit omitted or replaced.
export function buildTurnInspectorDetail(
  turnIndex: number,
  group: PiTurnGroup,
  contextEdits: Map<string, PiContextEdit> = new Map(),
): TurnInspectorDetail {
  const editOf = (entry: PiRawEntry): PiContextEdit | undefined =>
    typeof entry.id === "string" ? contextEdits.get(entry.id) : undefined;
  const assistantIndices = group.entries
    .map((entry, index) => (assistantMessageOf(entry) ? index : -1))
    .filter((index) => index !== -1);

  if (assistantIndices.length === 0) {
    return { turnIndex, userMessage: [], rounds: [] };
  }

  const assistantMessages = assistantIndices.map(
    (index) => assistantMessageOf(group.entries[index]) as PiAssistantMessage,
  );

  const rounds = assistantIndices.map((assistantIndex, roundIndex) => {
    const previousBoundary = roundIndex === 0 ? 0 : assistantIndices[roundIndex - 1] + 1;
    const addedEntries = group.entries.slice(previousBoundary, assistantIndex);

    const toolCalls = addedEntries.flatMap((entry) => {
      const toolResult = toolResultMessageOf(entry);
      if (!toolResult) {
        return [];
      }
      const toolCallId = typeof toolResult.toolCallId === "string" ? toolResult.toolCallId : undefined;
      const block = toolCallId ? findToolCallBlock(assistantMessages, toolCallId) : null;
      const edit = editOf(entry);
      return [
        {
          name: typeof toolResult.toolName === "string" ? toolResult.toolName : "unknown",
          args: [buildContentPart(toolCallArgumentsOf(block) ?? null)],
          result: [buildContentPart(toolResult.content ?? null)],
          ...(edit ? { contextEdit: contextEditFor(edit, "tool result") } : {}),
        },
      ];
    });

    const addedMessages = addedEntries
      .filter((entry) => !toolResultMessageOf(entry))
      .map(entryText)
      .filter((text) => text !== undefined)
      .map((text) => buildContentPart(text));
    const responseEdit = editOf(group.entries[assistantIndex]);

    const contentBlocks = assistantMessages[roundIndex].content ?? [];
    const reasoningParts = contentBlocks.filter(isThinkingBlock).map((block) => buildContentPart(blockText(block)));
    const responseParts = contentBlocks
      .filter((block) => !isThinkingBlock(block))
      .map((block) => buildContentPart(blockText(block)));

    return {
      request: { index: roundIndex, addedMessages, toolCalls },
      response: {
        index: roundIndex,
        response: responseParts,
        ...(reasoningParts.length > 0 ? { reasoning: reasoningParts } : {}),
        ...(responseEdit ? { contextEdit: contextEditFor(responseEdit, "response") } : {}),
      },
    };
  });

  return { turnIndex, userMessage: [], rounds };
}
