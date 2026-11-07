// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useState } from "react";
import type { AppHostPort } from "../../host/app-host-port.js";

// "Ask about this session" (plan §4.3): sends a fixed template naming only
// the session id. Never the title, a prompt or any other logged text (§6).

export function askAboutSessionText(sessionId: string): string {
  return `Analyse session ${sessionId}`;
}

type Phase = "idle" | "sending" | "sent" | "declined";

export function AskAboutSession({ port, sessionId }: { port: AppHostPort; sessionId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
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
