import { useEffect, useId, useRef, useState } from "react";
import type { Session } from "@agent-cost-analyzer/domain";
import { standaloneHostCapabilities } from "../host/host-capabilities.js";
import { buildAdviceBundle } from "../lib/build-advice-bundle.js";
import { useEscapeKey, useFocusTrap } from "../lib/focus.js";

interface AdviceExportDialogProps {
  sessions: Session[];
  open: boolean;
  onClose: () => void;
  // The host's clipboard (HostCapabilities, vscode-extension.md G8);
  // defaults to the browser's, as in the standalone app.
  copyToClipboard?: (text: string) => Promise<void>;
  // ProductProfile.displayName, named in the bundle (G10).
  productName?: string;
}

const browserCopy = standaloneHostCapabilities().copyToClipboard;

export function AdviceExportDialog({
  sessions,
  open,
  onClose,
  copyToClipboard = browserCopy,
  productName,
}: AdviceExportDialogProps) {
  const [includeToolArgs, setIncludeToolArgs] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [sessions, includeToolArgs, productName]);

  if (!open) {
    return null;
  }
  return (
    <OpenAdviceExportDialog
      sessions={sessions}
      onClose={onClose}
      copyToClipboard={copyToClipboard}
      productName={productName}
      includeToolArgs={includeToolArgs}
      onIncludeToolArgsChange={setIncludeToolArgs}
      previewOpen={previewOpen}
      onTogglePreview={() => setPreviewOpen((next) => !next)}
      copied={copied}
      onCopied={setCopied}
    />
  );
}

interface OpenAdviceExportDialogProps {
  sessions: Session[];
  onClose: () => void;
  copyToClipboard: (text: string) => Promise<void>;
  productName?: string;
  includeToolArgs: boolean;
  onIncludeToolArgsChange: (include: boolean) => void;
  previewOpen: boolean;
  onTogglePreview: () => void;
  copied: boolean;
  onCopied: (copied: boolean) => void;
}

// The open dialog, mounted only while open so its focus trap starts and
// ends with it (§3.5: dialogs trap focus while open, Escape closes them,
// and focus goes back to the opener).
function OpenAdviceExportDialog({
  sessions,
  onClose,
  copyToClipboard,
  productName,
  includeToolArgs,
  onIncludeToolArgsChange,
  previewOpen,
  onTogglePreview,
  copied,
  onCopied,
}: OpenAdviceExportDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(dialog);
  useEscapeKey(onClose);

  const bundle = buildAdviceBundle(sessions, { includeToolArgs, productName });
  const missingDetailCount = sessions.filter(
    (candidate) => candidate.turnCount > 0 && candidate.turns.length === 0,
  ).length;

  function handleCopy(): void {
    copyToClipboard(bundle)
      .then(() => onCopied(true))
      .catch(() => onCopied(false));
  }

  return (
    <div
      className="dialog-backdrop"
      data-testid="advice-dialog-backdrop"
      onClick={onClose}
    >
      <div
        ref={dialog}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ maxWidth: 560 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div id={titleId} className="dialog-title">
          Export advice bundle
        </div>
        <div className="dialog-body">
          <p className="text-muted" style={{ fontSize: 12, margin: "0 0 var(--space-2)" }}>
            Paste this into an LLM chat for advice on your agentic-coding workflow. Chat message text is never
            included — only session/turn metadata (token usage, cache efficiency, tool usage, prompt composition,
            AI Credits).
          </p>
          <div className="card-kicker" style={{ marginBottom: 6 }}>
            {sessions.length} session{sessions.length === 1 ? "" : "s"} selected for advice
          </div>
          {missingDetailCount > 0 && (
            <p style={{ fontSize: 12, margin: "0 0 var(--space-2)", color: "var(--color-accent-800)" }}>
              {missingDetailCount} selected session{missingDetailCount === 1 ? " hasn't" : "s haven't"} been opened
              yet — open {missingDetailCount === 1 ? "it" : "each"} in the list first to include its turn-level
              detail (tokens, cache, tool usage).
            </p>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: "var(--space-2)" }}>
            <input
              type="checkbox"
              aria-label="Include tool call args"
              checked={includeToolArgs}
              onChange={(event) => onIncludeToolArgsChange(event.target.checked)}
            />
            Include tool call args (may contain text snippets)
          </label>
          {previewOpen && (
            <pre
              data-testid="advice-preview"
              style={{
                maxHeight: 220,
                overflow: "auto",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                background: "var(--color-surface)",
                border: "1px solid var(--color-divider)",
                padding: "var(--space-2)",
                margin: 0,
              }}
            >
              {bundle}
            </pre>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onTogglePreview}>
            {previewOpen ? "Hide preview" : "Preview"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy advice prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}
