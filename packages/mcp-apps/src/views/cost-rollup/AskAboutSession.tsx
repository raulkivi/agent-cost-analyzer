// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useState } from "react";
import type { AppHostPort } from "../../host/app-host-port.js";

// "Ask about this session" (plan §4.3): sends a fixed template naming only
// the session id. Never the title, a prompt or any other logged text (§6).

export function askAboutSessionText(sessionId: string): string {
  return `Analyse session ${sessionId}`;
}

// A session id comes from the logs (a Claude Code id is the log's file
// name), so a crafted one could carry words into the chat. The providers'
// ids are UUIDs, hex hashes with a segment suffix and short slugs; anything
// else hides the button rather than being sent (A14).
const PLAIN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isPlainSessionId(sessionId: string): boolean {
  return PLAIN_ID.test(sessionId);
}

type Phase = "idle" | "sending" | "sent" | "declined";

// The one place a session id becomes a chat message: U2/U1's "Ask about this
// session" and U5's per-row "Analyse" both send through here (§4.3, §4.5).
function useAnalyse(port: AppHostPort, sessionId: string): { phase: Phase; send: () => void } {
  const [phase, setPhase] = useState<Phase>("idle");
  const send = () => {
    if (!isPlainSessionId(sessionId)) return;
    setPhase("sending");
    port.sendMessage(askAboutSessionText(sessionId)).then(
      (accepted) => setPhase(accepted ? "sent" : "declined"),
      () => setPhase("declined"),
    );
  };
  return { phase, send };
}

export function AskAboutSession({ port, sessionId }: { port: AppHostPort; sessionId: string }) {
  const { phase, send } = useAnalyse(port, sessionId);
  if (!isPlainSessionId(sessionId)) return null;
  return (
    <>
      {phase === "sent" && (
        <span role="status" className="text-muted">
          Sent to the chat.
        </span>
      )}
      {phase === "declined" && (
        <span role="status" className="text-muted">
          The host didn&apos;t accept the message.
        </span>
      )}
      <button type="button" className="btn btn-secondary view-btn" disabled={phase === "sending"} onClick={send}>
        Ask about this session
      </button>
    </>
  );
}

// U5's per-row button (owner answer Q6): "Analyse", then a disabled "Sent".
// `shortId` only names the button for assistive tech; the message carries the
// full session id and nothing else, never the row's title.
export function AnalyseRowButton({ port, sessionId, shortId }: { port: AppHostPort; sessionId: string; shortId: string }) {
  const { phase, send } = useAnalyse(port, sessionId);
  if (!isPlainSessionId(sessionId)) return null;
  const done = phase === "sent";
  return (
    <>
      {phase === "declined" && (
        <span role="status" className="text-muted sp-status">
          Not sent
        </span>
      )}
      <button type="button" className="btn btn-secondary view-btn sp-analyse" aria-label={done ? `Sent: session ${shortId}` : `Analyse session ${shortId}`} disabled={phase === "sending" || done} onClick={send}>
        {done ? "Sent" : "Analyse"}
      </button>
    </>
  );
}
