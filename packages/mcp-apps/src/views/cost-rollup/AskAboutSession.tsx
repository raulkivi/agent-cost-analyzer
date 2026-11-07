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

export function AskAboutSession({ port, sessionId }: { port: AppHostPort; sessionId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  if (!isPlainSessionId(sessionId)) return null;
  const ask = () => {
    setPhase("sending");
    port.sendMessage(askAboutSessionText(sessionId)).then(
      (accepted) => setPhase(accepted ? "sent" : "declined"),
      () => setPhase("declined"),
    );
  };
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
      <button type="button" className="btn btn-secondary view-btn" disabled={phase === "sending"} onClick={ask}>
        Ask about this session
      </button>
    </>
  );
}
