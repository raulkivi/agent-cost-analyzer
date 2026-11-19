// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useState } from "react";
import { ConnectAgentDialog } from "./ConnectAgentDialog.js";
import { PlugIcon } from "./icons.js";

// The header button of Header.dc.html and its dialog (mcp-client-setup.md
// §5.6.1). Icon plus text from 768 px; below that the text is hidden by CSS
// and the accessible name and tooltip stay. The dialog's focus trap returns
// focus here on close.
export function ConnectAgent() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary mcp-connect"
        aria-haspopup="dialog"
        aria-label="Connect an agent"
        title="Connect an agent"
        onClick={() => setOpen(true)}
      >
        <PlugIcon />
        <span className="mcp-connect-text">Connect an agent</span>
      </button>
      {open && <ConnectAgentDialog onClose={() => setOpen(false)} />}
    </>
  );
}
