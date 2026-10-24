import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getHostCapabilities } from "../../host/current-host-capabilities.js";

// How long a load runs before its skeleton appears: a quicker one shows
// nothing, rather than flashing a skeleton for a frame (§3.5 States).
export const SKELETON_DELAY_MS = 300;

export type AsyncStatus = "loading" | "error" | "empty" | "ready";

export type SkeletonShape = "list" | "table" | "panel";

interface AsyncViewProps {
  status: AsyncStatus;
  // What is loading, said at once to screen readers (and the progress
  // bar's name): "Loading sessions…".
  loadingText: string;
  // Announced when the data is on screen; optional.
  readyText?: string;
  // Roughly the final view's shape, so nothing jumps when data arrives.
  skeleton?: SkeletonShape;
  // Only where the call can really be cancelled; otherwise no Cancel.
  onCancel?: () => void;
  // Why it's empty, plus a next step.
  empty?: { title: string; body: ReactNode; action?: { label: string; onClick: () => void } };
  // What failed; Retry and Copy details are always offered.
  error?: { title: string; details?: string; onRetry: () => void };
  // Some data is missing: a warning above the content, never a zero
  // (constraint 6).
  partial?: ReactNode;
  // The host's clipboard for Copy details; the current host's by default.
  copyToClipboard?: (text: string) => Promise<void>;
  children?: ReactNode;
}

const SKELETON_ROWS: Record<SkeletonShape, number> = { list: 4, table: 6, panel: 3 };

function Skeleton({ shape, loadingText, onCancel }: { shape: SkeletonShape; loadingText: string; onCancel?: () => void }) {
  return (
    <div className="async-skeleton" data-testid="async-skeleton" aria-busy="true">
      <div className="async-progress" role="progressbar" aria-label={loadingText}>
        <div className="async-progress-bar" />
      </div>
      <div aria-hidden="true" className="async-skeleton-blocks">
        <div className="async-skeleton-line" style={{ width: "60%" }} />
        {Array.from({ length: SKELETON_ROWS[shape] }, (_, index) => (
          <div key={index} className={shape === "list" ? "async-skeleton-card" : "async-skeleton-row"} />
        ))}
      </div>
      {onCancel && (
        <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

function ErrorState({
  error,
  copyToClipboard,
}: {
  error: NonNullable<AsyncViewProps["error"]>;
  copyToClipboard: (text: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const report = error.details ? `${error.title}\n${error.details}` : error.title;
  return (
    <div className="async-error" role="alert">
      <div className="async-error-message">
        <span aria-hidden="true" className="async-error-icon">
          ✕
        </span>
        <div>
          <strong>{error.title}</strong>
          {error.details && <div className="mono async-error-details">{error.details}</div>}
          <div>Nothing was changed: this view only reads your logs.</div>
        </div>
      </div>
      <div className="async-actions">
        <button type="button" className="btn btn-primary" onClick={error.onRetry}>
          Try again
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            copyToClipboard(report)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "Copied" : "Copy details"}
        </button>
      </div>
    </div>
  );
}

// One pattern for every data view's loading, empty, error and partial
// states (vscode-extension.md §3.5 States, mock-up board 5). A polite live
// region announces the load and its result; errors are alerts.
export function AsyncView({
  status,
  loadingText,
  readyText,
  skeleton = "panel",
  onCancel,
  empty,
  error,
  partial,
  copyToClipboard = (text) => getHostCapabilities().copyToClipboard(text),
  children,
}: AsyncViewProps) {
  const [showSkeleton, setShowSkeleton] = useState(false);

  useEffect(() => {
    setShowSkeleton(false);
    if (status !== "loading") return;
    const timer = setTimeout(() => setShowSkeleton(true), SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const announcement = status === "loading" ? loadingText : status === "ready" ? (readyText ?? "") : "";

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      {status === "loading" && showSkeleton && <Skeleton shape={skeleton} loadingText={loadingText} onCancel={onCancel} />}
      {status === "error" && error && <ErrorState error={error} copyToClipboard={copyToClipboard} />}
      {status === "empty" && empty && (
        <div className="async-empty">
          <h4 style={{ margin: 0 }}>{empty.title}</h4>
          <div className="text-muted async-empty-body">{empty.body}</div>
          {empty.action && (
            <button type="button" className="btn btn-secondary" onClick={empty.action.onClick}>
              {empty.action.label}
            </button>
          )}
        </div>
      )}
      {status === "ready" && (
        <>
          {partial && (
            <div className="async-partial" role="note">
              <span aria-hidden="true">⚠</span>
              <span>
                <strong>Partial data.</strong> {partial}
              </span>
            </div>
          )}
          {children}
        </>
      )}
    </>
  );
}
