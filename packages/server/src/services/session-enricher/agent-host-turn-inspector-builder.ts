import type { MessageContentPart, TurnInspectorDetail } from "@agent-cost-analyzer/domain";
import type { CopilotEvent } from "../../data-sources/agent-host/copilot-event.js";
import { buildContentPart } from "../../data-sources/log-providers/build-content-parts.js";
import { isSubagentEvent, type MatchedTurn } from "./copilot-turn-segmenter.js";

// Turn inspector rounds for one VS Code Agent Host turn, from the Copilot CLI
// event log (vscode-extension.md step 10.14, architecture.md §6.2.2.2). Pure:
// the segmenter already cut the turn. The domain's inspector shape has no
// usage field, so per-round tokens aren't carried here (they stay from
// session.db).

export const NO_TOOL_RESULT_TEXT = "No result recorded for this call in this turn.";

type RoundToolCall = TurnInspectorDetail["rounds"][number]["request"]["toolCalls"][number];

interface ToolRequest {
  toolCallId: string;
  name: string;
  arguments: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function textPart(value: string): MessageContentPart {
  return buildContentPart(value);
}

function toolRequestsOf(message: CopilotEvent): ToolRequest[] {
  const raw = message.data.toolRequests;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const request = asRecord(item);
    const toolCallId = text(request?.toolCallId);
    return request && toolCallId ? [{ toolCallId, name: text(request.name) ?? "unknown", arguments: request.arguments }] : [];
  });
}

// Attachments become placeholder chips: file contents and base64 blobs never
// reach the inspector (constraint: nothing inline, nothing oversized).
function attachmentPart(attachment: Record<string, unknown>): MessageContentPart | null {
  const mimeType = text(attachment.mimeType);
  if (attachment.type === "blob") {
    const data = text(attachment.data);
    const sizeBytes = data === null ? undefined : Buffer.from(data, "base64").length;
    if (mimeType?.startsWith("image/")) {
      return { placeholder: true, kind: "image", ...(sizeBytes !== undefined ? { sizeBytes } : {}) };
    }
    const displayName = text(attachment.displayName);
    return {
      placeholder: true,
      kind: "file",
      ...(displayName ? { path: displayName } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    };
  }
  const filePath = text(attachment.path);
  return filePath ? { placeholder: true, kind: "file", path: filePath } : null;
}

function attachmentParts(userMessage: CopilotEvent, preRoundEvents: CopilotEvent[]): MessageContentPart[] {
  const attachments = Array.isArray(userMessage.data.attachments) ? userMessage.data.attachments : [];
  const parts: MessageContentPart[] = [];
  const coveredAssets = new Set<string>();
  for (const item of attachments) {
    const attachment = asRecord(item);
    if (!attachment) continue;
    const assetId = text(attachment.assetId);
    if (assetId) coveredAssets.add(assetId);
    const part = attachmentPart(attachment);
    if (part) parts.push(part);
  }
  // A session.binary_asset the attachments don't refer to still reached the model.
  for (const event of preRoundEvents) {
    if (event.type !== "session.binary_asset" || coveredAssets.has(text(event.data.assetId) ?? "")) continue;
    const byteLength = event.data.byteLength;
    parts.push({ placeholder: true, kind: "image", ...(typeof byteLength === "number" ? { sizeBytes: byteLength } : {}) });
  }
  return parts;
}

function resultParts(complete: CopilotEvent, toolName: string): MessageContentPart[] {
  if (complete.data.success === false) {
    const error = asRecord(complete.data.error);
    const message = text(error?.message) ?? "the tool failed";
    const code = text(error?.code);
    return [textPart(code ? `Error (${code}): ${message}` : `Error: ${message}`)];
  }
  const result = asRecord(complete.data.result);
  return [buildContentPart(result?.content ?? result ?? null, { toolName })];
}

function toolCall(request: ToolRequest | undefined, result: MessageContentPart[]): RoundToolCall {
  return {
    name: request?.name ?? "unknown",
    args: [buildContentPart(request?.arguments ?? null, { toolName: request?.name })],
    result,
  };
}

// What round N+1 sends back: the results of the calls round N requested.
function toolCallsCompletedIn(slice: CopilotEvent[], requests: Map<string, ToolRequest>): RoundToolCall[] {
  const completes = slice.filter((e) => e.type === "tool.execution_complete");
  const completed = new Set(completes.map((e) => text(e.data.toolCallId)));
  const finished = completes.map((complete) => {
    const request = requests.get(text(complete.data.toolCallId) ?? "");
    return toolCall(request, resultParts(complete, request?.name ?? ""));
  });
  const unfinished = slice
    .filter((e) => e.type === "assistant.message")
    .flatMap(toolRequestsOf)
    .filter((request) => !completed.has(request.toolCallId))
    .map((request) => toolCall(request, [textPart(NO_TOOL_RESULT_TEXT)]));
  return [...finished, ...unfinished];
}

function responseParts(messages: CopilotEvent[]): { response: MessageContentPart[]; reasoning: MessageContentPart[] } {
  const response: MessageContentPart[] = [];
  const reasoning: MessageContentPart[] = [];
  for (const message of messages) {
    const content = text(message.data.content);
    if (content) response.push(textPart(content));
    // The domain has no tool-request field, so requests read as response parts.
    for (const request of toolRequestsOf(message)) {
      response.push(buildContentPart({ name: request.name, arguments: request.arguments }));
    }
    const reasoningText = text(message.data.reasoningText);
    if (reasoningText) reasoning.push(textPart(reasoningText));
  }
  return { response, reasoning };
}

export function buildAgentHostTurnInspector(turnIndex: number, turn: MatchedTurn): TurnInspectorDetail {
  const mainEvents = turn.events.filter((event) => !isSubagentEvent(event));
  const starts = mainEvents.flatMap((e, i) => (e.type === "assistant.turn_start" ? [i] : []));
  const preRound = mainEvents.slice(0, starts[0] ?? mainEvents.length);

  const typed = text(turn.userMessage.data.content);
  const modelSeen = text(turn.userMessage.data.transformedContent) ?? typed;
  const attachments = attachmentParts(turn.userMessage, preRound);
  const userMessage = [...(typed ? [textPart(typed)] : []), ...attachments];

  const requests = new Map<string, ToolRequest>();
  for (const message of mainEvents.filter((e) => e.type === "assistant.message")) {
    for (const request of toolRequestsOf(message)) requests.set(request.toolCallId, request);
  }

  const slices = starts.map((from, i) => mainEvents.slice(from, starts[i + 1] ?? mainEvents.length));
  const rounds = slices.map((slice, index) => {
    const parts = responseParts(slice.filter((e) => e.type === "assistant.message"));
    return {
      request: {
        index,
        addedMessages: index === 0 ? [...(modelSeen ? [textPart(modelSeen)] : []), ...attachments] : [],
        toolCalls: index === 0 ? [] : toolCallsCompletedIn(slices[index - 1]!, requests),
      },
      response: {
        index,
        response: parts.response,
        ...(parts.reasoning.length > 0 ? { reasoning: parts.reasoning } : {}),
      },
    };
  });

  return { turnIndex, userMessage, rounds };
}
