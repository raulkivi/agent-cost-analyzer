// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Turn } from "@agent-cost-analyzer/domain";
import type { Mode } from "../state/session-store.js";
import { TRIGGER_LABELS } from "../lib/trigger-labels.js";
import { SubagentRunsBlock } from "./SubagentRunsBlock.js";
import { Blueprint } from "./ui/Blueprint.js";
import { StatusTag } from "./ui/StatusTag.js";
import { Tag } from "./ui/Tag.js";

interface ExplanationPanelProps {
  turn: Turn | null;
  mode: Mode;
  toolCallsAvailable?: boolean;
  eventLogUnavailableReason?: string;
  // Analyze mode only (both LogProvider implementations, per turn-inspector-
  // plan.md §5.7) — Learn mode sessions have no backing log source to
  // inspect.
  onOpenTurnInspector?: () => void;
}

function ToolCallsThisTurn({
  turn,
  toolCallsAvailable,
  eventLogUnavailableReason,
  onOpenTurnInspector,
}: {
  turn: Turn;
  toolCallsAvailable: boolean;
  eventLogUnavailableReason?: string;
  onOpenTurnInspector?: () => void;
}) {
  return (
    <div className="tool-calls-block">
      <div className="tool-calls-head">
        <div className="sub-label">Tool calls this turn</div>
        {onOpenTurnInspector && (
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={onOpenTurnInspector}
          >
            Inspect request/response
          </button>
        )}
      </div>
      {!toolCallsAvailable ? (
        <p className="text-muted text-xs m-0">
          {turn.toolCallsUnavailableReason ??
            eventLogUnavailableReason ??
            "Tool-call detail unavailable for this session."}
        </p>
      ) : turn.toolCalls.length === 0 ? (
        <p className="text-muted text-xs m-0">
          No tools called this turn.
        </p>
      ) : (
        <div className="tool-call-list">
          {turn.toolCalls.map((toolCall, index) => (
            <div key={`${toolCall.name}-${index}`} className="tool-call-row">
              <Tag variant="neutral" className="tag-mono">
                {toolCall.name}
              </Tag>
              {toolCall.outcome && <StatusTag outcome={toolCall.outcome} />}
              {toolCall.shell && (
                <span title={toolCall.shell.command} className="mono truncate tool-call-command">
                  {toolCall.shell.command}
                </span>
              )}
              {(toolCall.filesTouched ?? []).map((file) => (
                <span key={file} title={file} className="text-muted truncate tool-call-file">
                  {file}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExplanationPanel({
  turn,
  mode,
  toolCallsAvailable = false,
  eventLogUnavailableReason,
  onOpenTurnInspector,
}: ExplanationPanelProps) {
  if (!turn) {
    return (
      <Blueprint className="blueprint--tight">
        <p className="m-0">No turn selected.</p>
      </Blueprint>
    );
  }

  return (
    <Blueprint className="blueprint--tight">
      <div className="card-kicker">Turn {turn.index} · why</div>
      {turn.triggeredEvent && (
        <Tag variant="outline" className="tag-lead">
          {TRIGGER_LABELS[turn.triggeredEvent]}
        </Tag>
      )}
      {turn.simulation && (
        <Tag variant="accent" className="tag-lead">
          Simulated
        </Tag>
      )}
      <p className="explanation-text">{turn.explanation}</p>
      {turn.simulation && (
        <p className="explanation-text">
          <span className="sr-only">Simulation note</span>
          {turn.simulation.note}
        </p>
      )}
      <SubagentRunsBlock turn={turn} />
      {mode === "analyze" && (
        <ToolCallsThisTurn
          turn={turn}
          toolCallsAvailable={toolCallsAvailable}
          eventLogUnavailableReason={eventLogUnavailableReason}
          onOpenTurnInspector={onOpenTurnInspector}
        />
      )}
    </Blueprint>
  );
}
