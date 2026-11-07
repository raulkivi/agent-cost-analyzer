// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SessionReplayLoad } from "../../state/use-session-replay.js";
import { AsyncView } from "../ui/AsyncView.js";

interface ReplayStatusProps {
  status: SessionReplayLoad["status"];
  error?: string;
  errorStatus?: number;
  // The model asked for.
  model: string | null;
  onCancel(): void;
  onRetry(): void;
}

// Mock-up board 4's states above the turns table: the invitation while
// replay is off, loading with Cancel (b), not replayable in the API's own
// words (c, a 404: retrying won't help), and a failed request with the
// app's Try again and Copy details (f).
// A ready replay shows its summary strip instead.
export function ReplayStatus({ status, error, errorStatus, model, onCancel, onRetry }: ReplayStatusProps) {
  if (status === "ready") return null;
  if (status === "idle" || model === null) {
    return (
      <p className="text-muted replay-hint">
        Choose a model in Replay on to see what this session would have cost there, beside what it did cost. The replay keeps the
        session's turns and token counts; only caching and prices change.
      </p>
    );
  }
  if (status === "loading") {
    return <AsyncView status="loading" loadingText={`Replaying on ${model}…`} skeleton="panel" onCancel={onCancel} />;
  }
  if (errorStatus === 404) {
    return (
      <div role="status" className="replay-note">
        <strong>This session can't be replayed</strong>
        <span>{error}</span>
        <span className="text-muted">Its measured figures are unchanged.</span>
      </div>
    );
  }
  return (
    <AsyncView
      status="error"
      loadingText=""
      error={{
        title: `Couldn't replay on ${model}`,
        details: error ?? "The replay request failed.",
        onRetry,
      }}
    />
  );
}
