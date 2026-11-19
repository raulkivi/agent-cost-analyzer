// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { LoadState } from "../../lib/use-cancellable-load.js";
import { CLIENT_LABELS, installCommandFor, notesFor } from "../../lib/mcp-setup/clients.js";
import type { McpSetupClient, McpSetupClientId, McpSetupResponse } from "@agent-cost-analyzer/domain";
import { CodeBlock } from "./CodeBlock.js";
import { PlugIcon } from "./icons.js";

interface ClientPanelProps {
  id: McpSetupClientId;
  setup: LoadState<McpSetupResponse>;
  onRetry: () => void;
}

// The one-liner needs no API data, so it shows while loading and on an error;
// only the by-hand part waits for GET /api/mcp/setup.
export function ClientPanel({ id, setup, onRetry }: ClientPanelProps) {
  const label = CLIENT_LABELS[id];
  const client = setup.kind === "ready" ? setup.data.clients.find((candidate) => candidate.id === id) : undefined;

  // A server that does not list this client fails the same way as no answer.
  const failed = setup.kind === "error" || setup.kind === "cancelled" || (setup.kind === "ready" && !client); // codespell:ignore cancelled

  return (
    <>
      <h3 className="mcp-client-name">{label}</h3>
      <h4 className="mcp-sub">Recommended: one command</h4>
      <CodeBlock text={client?.installCommand ?? installCommandFor(id)} label={`Install command for ${label}`} copyLabel="install command" />
      <p className="mcp-help">Run it in a terminal. It shows what it will change and asks before writing.</p>
      {setup.kind === "loading" && <Loading />}
      {failed && <LoadError onRetry={onRetry} />}
      {client && <ByHand client={client} />}
    </>
  );
}

function Loading() {
  return (
    <>
      <h4 className="mcp-sub">Or set it up by hand</h4>
      <div className="mcp-skeleton" aria-hidden="true">
        <span />
        <span />
      </div>
      <p role="status" className="mcp-help">
        Loading setup details…
      </p>
    </>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="mcp-error">
      <b>Could not load the setup details.</b> The command above does not need them.{" "}
      <button type="button" className="mcp-link" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function ByHand({ client }: { client: McpSetupClient }) {
  const notes = notesFor(client.id);
  const { manual } = client;
  return (
    <>
      <h4 className="mcp-sub">Or set it up by hand</h4>
      {manual.kind === "command" ? (
        <>
          <p className="mcp-help">Run in a terminal:</p>
          <CodeBlock text={manual.command} label={`Setup command for ${client.label}`} copyLabel="setup command" />
        </>
      ) : (
        <>
          <p className="mcp-help">
            Add to <code>{manual.path}</code>:
          </p>
          <CodeBlock text={manual.json} label={`Setup JSON for ${client.label}`} copyLabel="setup JSON" />
        </>
      )}
      {notes.manual && <p className="mcp-note">{notes.manual}</p>}
      {client.installLink && (
        <>
          <h4 className="mcp-sub">Or use the install link</h4>
          <a className="btn btn-secondary mcp-install-link" href={client.installLink}>
            <PlugIcon />
            Add to {client.label}
          </a>
          <p className="mcp-help">Opens a cursor:// link in the Cursor app.</p>
          {notes.installLink && <p className="mcp-note">{notes.installLink}</p>}
        </>
      )}
    </>
  );
}
