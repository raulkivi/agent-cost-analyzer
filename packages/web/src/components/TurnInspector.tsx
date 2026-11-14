// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  ContentPlaceholder,
  MessageContentPart,
  TriggeredEvent,
  Turn,
  TurnInspectorDetail,
} from "@agent-cost-analyzer/domain";
import { fetchTurnInspectorDetail } from "../api-client/sessions.js";
import { TURN_INSPECTOR_UNAVAILABLE_TITLE } from "../lib/agent-host-unavailable.js";
import { useEscapeKey, useFocusReturn } from "../lib/focus.js";
import { useCancellableLoad } from "../lib/use-cancellable-load.js";
import { subagentInspectorNote } from "../lib/subagent-runs.js";
import { TRIGGER_LABELS } from "../lib/trigger-labels.js";
import { buildPrettyTokens, PAYLOAD_TOKEN_COLORS, unescapeText } from "../lib/turn-payload-pretty.js";
import type { PayloadToken } from "../lib/turn-payload-pretty.js";
import { AsyncView, cancelledEmptyState } from "./ui/AsyncView.js";
import { Blueprint } from "./ui/Blueprint.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";
import { Tag } from "./ui/Tag.js";

interface TurnInspectorProps {
  sessionId: string;
  turnIndex: number;
  sessionTitle?: string;
  triggeredEvent?: TriggeredEvent;
  // Session.usageDataAvailable, already known from the GET /api/sessions/:id
  // call the UI made before this could be opened — lets the empty state
  // pick the right message without waiting on this endpoint's own fetch.
  usageDataAvailable: boolean;
  // The turn shown, for the note about subagent runs this view leaves out (D4).
  turn?: Turn | undefined;
  onClose: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  // The person pressed Cancel on the loading skeleton.
  | { status: "cancelled" }
  // Nothing to fetch: the session has no usage data at all (logging off).
  | { status: "not-captured" }
  // The provider says this turn is unknown (detail.unavailableReason).
  | { status: "unavailable"; reason: string }
  | { status: "ready"; detail: TurnInspectorDetail };

type PayloadFormat = "pretty" | "raw";

const FORMAT_OPTIONS = [
  { value: "pretty", label: "Pretty" },
  { value: "raw", label: "Raw" },
] as const;

const NO_LOGGING_MESSAGE =
  "No request/response data captured for this session — enable agentDebugLog.fileLogging.enabled and reload VS Code.";
const NO_ROUND_TRIP_MESSAGE = "This turn made no request to the model, so there is no request or response to show.";
const LOAD_FAILED_MESSAGE = "Failed to load this turn's request/response data.";
const ENCRYPTED_REASONING_TEXT = "[encrypted]";

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentLabel(part: ContentPlaceholder): string {
  if (part.kind === "image") {
    return "image";
  }
  const size = part.sizeBytes !== undefined ? formatBytes(part.sizeBytes) : undefined;
  if (part.path) {
    return size ? `${part.path} · ${size}` : part.path;
  }
  return size ?? "file";
}

function payloadTokens(text: string, format: PayloadFormat): PayloadToken[] {
  if (format === "raw") {
    return [{ text, color: PAYLOAD_TOKEN_COLORS.plain }];
  }
  return buildPrettyTokens(text) ?? [{ text: unescapeText(text), color: PAYLOAD_TOKEN_COLORS.plain }];
}

function renderTokens(tokens: PayloadToken[]): ReactNode {
  return tokens.map((token, index) => (
    <span key={index} style={{ color: token.color }}>
      {token.text}
    </span>
  ));
}

// A round's reasoning is a known condition, not content, when the provider
// withholds it entirely — recognizable as a lone text part whose literal
// value is the provider's own placeholder string.
function isEncryptedReasoning(parts: MessageContentPart[]): boolean {
  return parts.length === 1 && parts[0].kind === "text" && parts[0].text.trim() === ENCRYPTED_REASONING_TEXT;
}

function SubLabel({ children }: { children: ReactNode }) {
  return <div className="sub-label sub-label--stacked">{children}</div>;
}

function ContentPartsView({
  parts,
  format,
  maxHeight,
}: {
  parts: MessageContentPart[];
  format: PayloadFormat;
  maxHeight: number;
}) {
  if (parts.length === 0) {
    return (
      <p className="text-muted text-xs m-0">
        —
      </p>
    );
  }
  return (
    <div style={{ maxHeight, overflowY: "auto" }}>
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <pre key={index} className="payload-pre">
            {renderTokens(payloadTokens(part.text, format))}
          </pre>
        ) : (
          <Tag key={index} variant="outline" className="tag-attachment">
            {attachmentLabel(part)}
          </Tag>
        ),
      )}
    </div>
  );
}

function UserMessageView({ parts }: { parts: MessageContentPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <p key={index} className="m-0 text-md">
            {part.text}
          </p>
        ) : (
          <Tag key={index} variant="outline" className="tag-attachment">
            {attachmentLabel(part)}
          </Tag>
        ),
      )}
    </>
  );
}

function ToolCallsView({
  toolCalls,
  format,
}: {
  toolCalls: TurnInspectorDetail["rounds"][number]["request"]["toolCalls"];
  format: PayloadFormat;
}) {
  if (toolCalls.length === 0) {
    return null;
  }
  return (
    <div className="inspector-tool-calls">
      {toolCalls.map((toolCall, index) => (
        <div key={`${toolCall.name}-${index}`} className="inspector-tool-call">
          <Tag variant="neutral" className="tag-mono self-start">
            {toolCall.name}
          </Tag>
          <SubLabel>Args</SubLabel>
          <ContentPartsView parts={toolCall.args} format={format} maxHeight={140} />
          <SubLabel>Result</SubLabel>
          <ContentPartsView parts={toolCall.result} format={format} maxHeight={140} />
        </div>
      ))}
    </div>
  );
}

export function TurnInspector({
  sessionId,
  turnIndex,
  sessionTitle,
  triggeredEvent,
  usageDataAvailable,
  turn,
  onClose,
}: TurnInspectorProps) {
  // Nothing to load when the session has no usage data; otherwise the
  // fetch is cancellable (Cancel on the skeleton).
  const loadDetail = useCallback(
    (signal: AbortSignal) => fetchTurnInspectorDetail(sessionId, turnIndex, signal),
    [sessionId, turnIndex],
  );
  const { state: load, cancel, retry } = useCancellableLoad(loadDetail, usageDataAvailable);
  const state: LoadState = !usageDataAvailable
    ? { status: "not-captured" }
    : load.kind === "ready"
      ? load.data.unavailableReason
        ? { status: "unavailable", reason: load.data.unavailableReason }
        : { status: "ready", detail: load.data }
      : load.kind === "error"
        ? { status: "error" }
        : load.kind === "cancelled"
          ? { status: "cancelled" }
          : { status: "loading" };
  // §3.5: focus starts on Back and returns to the opener; Escape closes.
  const backButton = useRef<HTMLButtonElement>(null);
  useFocusReturn(backButton);
  useEscapeKey(onClose);
  const [format, setFormat] = useState<PayloadFormat>("pretty");
  const subagentNote = turn ? subagentInspectorNote(turn) : undefined;
  // The picked round belongs to the detail it was picked in, so a newly
  // loaded turn starts at round 0 without a reset effect racing a click.
  const [roundPick, setRoundPick] = useState<{ detail: TurnInspectorDetail; round: number } | null>(null);
  const loadedDetail = state.status === "ready" ? state.detail : undefined;
  const selectedRound = roundPick && roundPick.detail === loadedDetail ? roundPick.round : 0;

  return (
    <div className="inspector">
      <div className="inspector-row">
        <button ref={backButton} type="button" className="btn btn-secondary" onClick={onClose}>
          ← Back to session
        </button>
        {sessionTitle && (
          <span className="text-muted text-xs">
            {sessionTitle}
          </span>
        )}
        <h4 className="m-0">Turn {turnIndex + 1} inspector</h4>
        {triggeredEvent && <Tag variant="outline">{TRIGGER_LABELS[triggeredEvent]}</Tag>}
        <div className="ml-auto">
          <SegmentedControl name="turnFormat" options={FORMAT_OPTIONS} value={format} onChange={setFormat} />
        </div>
      </div>

      {subagentNote && (
        <div role="note" className="subagent-note">
          <strong>{subagentNote.heading}</strong> <span className="text-muted">{subagentNote.body}</span>
        </div>
      )}

      <AsyncView
        status={
          state.status === "not-captured" ||
          state.status === "unavailable" ||
          state.status === "cancelled" ||
          (state.status === "ready" && state.detail.rounds.length === 0)
            ? "empty"
            : state.status
        }
        loadingText="Loading turn detail…"
        readyText="Turn detail loaded."
        onCancel={cancel}
        error={{ title: LOAD_FAILED_MESSAGE, onRetry: retry }}
        empty={
          state.status === "cancelled"
            ? cancelledEmptyState(retry)
            : state.status === "unavailable"
              ? { title: TURN_INSPECTOR_UNAVAILABLE_TITLE, body: state.reason }
              : state.status === "not-captured"
                ? { title: "No request or response captured", body: NO_LOGGING_MESSAGE }
                : { title: "No model request", body: NO_ROUND_TRIP_MESSAGE }
        }
      >
        {state.status === "ready" &&
          state.detail.rounds.length > 0 &&
          (() => {
            const { detail } = state;
            const round = detail.rounds.find((r) => r.request.index === selectedRound) ?? detail.rounds[0];
            const roundOptions = detail.rounds.map((r) => ({
              value: String(r.request.index),
              label: `Round ${r.request.index}`,
            }));

            return (
              <>
                {detail.userMessage.length > 0 && (
                  <Blueprint className="blueprint--tight">
                    <div className="card-kicker kicker--stacked">
                      User message
                    </div>
                    <UserMessageView parts={detail.userMessage} />
                  </Blueprint>
                )}

                {detail.rounds.length > 1 && (
                  <div className="inspector-row">
                    <SegmentedControl
                      name="turnRound"
                      options={roundOptions}
                      value={String(round.request.index)}
                      onChange={(value) => setRoundPick({ detail, round: Number(value) })}
                    />
                    <span className="text-muted text-xs">
                      {detail.rounds.length} rounds in this turn
                    </span>
                  </div>
                )}

                <div className="inspector-columns">
                  <Blueprint className="blueprint--tight">
                    <div className="card-kicker kicker--stacked">
                      Request · round {round.request.index}
                    </div>
                    <ToolCallsView toolCalls={round.request.toolCalls} format={format} />
                    {round.request.addedMessages.length > 0 && (
                      <>
                        <SubLabel>Added messages</SubLabel>
                        <ContentPartsView parts={round.request.addedMessages} format={format} maxHeight={260} />
                      </>
                    )}
                  </Blueprint>
                  <Blueprint className="blueprint--tight">
                    <div className="card-kicker kicker--stacked">
                      Response · round {round.response.index}
                    </div>
                    <ContentPartsView parts={round.response.response} format={format} maxHeight={320} />
                    {round.response.reasoning && isEncryptedReasoning(round.response.reasoning) && (
                      <div className="inspector-reasoning inspector-reasoning--row">
                        <div className="card-kicker">Reasoning</div>
                        <Tag variant="outline">encrypted</Tag>
                        <span className="text-muted text-2xs">
                          withheld by the provider
                        </span>
                      </div>
                    )}
                    {round.response.reasoning && !isEncryptedReasoning(round.response.reasoning) && (
                      <div className="inspector-reasoning">
                        <div className="card-kicker kicker--stacked">
                          Reasoning
                        </div>
                        <ContentPartsView parts={round.response.reasoning} format={format} maxHeight={200} />
                      </div>
                    )}
                  </Blueprint>
                </div>
              </>
            );
          })()}
      </AsyncView>
    </div>
  );
}
