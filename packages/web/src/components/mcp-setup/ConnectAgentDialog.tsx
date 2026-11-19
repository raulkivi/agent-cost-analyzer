// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useId, useRef, useState } from "react";
import { fetchMcpSetup } from "../../api-client/mcp-setup.js";
import { useEscapeKey, useFocusTrap } from "../../lib/focus.js";
import { readLastClient, writeLastClient } from "../../lib/mcp-setup/last-client.js";
import type { McpSetupClientId } from "../../lib/mcp-setup/types.js";
import { useCancellableLoad } from "../../lib/use-cancellable-load.js";
import { useMediaQuery } from "../../lib/use-media-query.js";
import { ClientNav, tabId } from "./ClientNav.js";
import { ClientPanel } from "./ClientPanel.js";

// Below this the two columns no longer fit, and a select replaces the tabs
// (Narrow.dc.html: 360 px).
export const NARROW_QUERY = "(max-width: 520px)";

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

interface ConnectAgentDialogProps {
  onClose: () => void;
}

// Shows how to register the MCP server with each client. It only shows: no
// control here writes a file or runs a command (mcp-client-setup.md D1); the
// terminal command is the writer. Focus starts on the selected tab, Tab
// cycles inside, Escape or Close gives focus back to the header button.
export function ConnectAgentDialog({ onClose }: ConnectAgentDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const idBase = useId();
  const panelId = `${idBase}-panel`;
  const [selected, setSelected] = useState<McpSetupClientId>(() => readLastClient(localStorageOrNull()));
  const asSelect = useMediaQuery(NARROW_QUERY);
  const { state: setup, retry } = useCancellableLoad(fetchMcpSetup);
  useFocusTrap(dialog);
  useEscapeKey(onClose);
  // The trap would focus the first control, the × in the corner; the person
  // chose an agent, so focus starts there (A11y.dc.html: the selected tab, or
  // the select at narrow widths). Declared after the trap, so it runs after.
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], .mcp-agent-select select')?.focus();
  }, []);

  function select(id: McpSetupClientId): void {
    writeLastClient(localStorageOrNull(), id);
    setSelected(id);
  }

  return (
    <div className="dialog-backdrop" data-testid="connect-agent-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="dialog mcp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mcp-head">
          <div id={titleId} className="dialog-title">
            Connect an agent
          </div>
          <button type="button" className="btn btn-ghost mcp-x" aria-label="Close" title="Close" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <p className="mcp-intro">
          Let your coding agent ask this app about its own costs. This panel only shows commands. Run them in a terminal; nothing here
          changes your files.
        </p>
        <div className="mcp-body">
          <ClientNav selected={selected} onSelect={select} asSelect={asSelect} idBase={idBase} panelId={panelId} />
          <div
            id={panelId}
            className="mcp-panel"
            {...(asSelect ? {} : { role: "tabpanel", "aria-labelledby": tabId(idBase, selected) })}
          >
            <ClientPanel id={selected} setup={setup} onRetry={retry} />
          </div>
        </div>
        <div className="mcp-footer">
          <span className="mcp-version">
            {setup.kind === "ready" ? `Version ${setup.data.version} · runs` : "Runs"} the latest release through npx
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
