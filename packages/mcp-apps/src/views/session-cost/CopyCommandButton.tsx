// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useState } from "react";
import type { ClipboardPort } from "../../host/clipboard-port.js";
import { OPEN_SESSION_COMMAND_TITLE } from "./open-command.js";

// Both hosts refuse vscode:// links (plan §4.4), so the view copies the
// session title for the extension's "Open Session…" picker. The caller hides all of this when
// there is no clipboard. The button sits in the footer and the status line
// above it, so the state is shared through this hook.

const COPIED_MS = 2000;
const HINT_MS = 8000;

type Phase = "idle" | "copied" | "hint" | "failed";

export function useCopyCommand(clipboard: ClipboardPort, command: string): { phase: Phase; copy: () => void } {
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    if (phase === "idle") return undefined;
    const timer = setTimeout(() => setPhase(phase === "copied" ? "hint" : "idle"), phase === "copied" ? COPIED_MS : HINT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const copy = () => {
    clipboard.writeText(command).then(
      () => setPhase("copied"),
      () => setPhase("failed"),
    );
  };
  return { phase, copy };
}

// No aria-live on the button: CopyCommandStatus is the live region, so the
// result is announced once, with the command text.
export function CopyCommandButton({ phase, onCopy }: { phase: Phase; onCopy: () => void }) {
  return (
    <button type="button" className="btn btn-secondary view-btn" onClick={onCopy}>
      {phase === "copied" ? "Copied" : "Copy title to open in panel"}
    </button>
  );
}

export function CopyCommandStatus({ phase, command }: { phase: Phase; command: string }) {
  if (phase === "idle") return null;
  return (
    <div className="view-copied" role="status">
      {phase === "failed" ? (
        <span>
          Couldn&apos;t copy. Run &quot;{OPEN_SESSION_COMMAND_TITLE}&quot; from the Command Palette and search for: <code>{command}</code>
        </span>
      ) : (
        <span>
          Copied <code>{command}</code>. Run &quot;{OPEN_SESSION_COMMAND_TITLE}&quot; from the Command Palette (Ctrl+Shift+P) and paste it.
        </span>
      )}
    </div>
  );
}
