// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import type { SessionCost } from "@agent-cost-analyzer/domain";
import type { ViewBrand } from "../../brand/view-brand.js";
import type { AppHostPort } from "../../host/app-host-port.js";
import type { ClipboardPort } from "../../host/clipboard-port.js";
import { ErrorBox, SessionCostView } from "../SessionCostView.js";
import { ViewShell } from "../ViewShell.js";
import { callParsed, parseSessionCost, useResource } from "../session-cost/tool-data.js";
import { AskAboutSession } from "./AskAboutSession.js";
import "./cost-rollup.css";

// U2 to U1 in place (plan §4.3): get_session_cost through the port, the same
// tool the model can call, then the U1 view with a back control. The rollup
// stays in the parent, so going back refetches nothing.

export interface SessionRef {
  sessionId: string;
  providerId: string;
}

const KICKER = "Cost rollup › Session cost";

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <div className="rv-back">
      <button type="button" className="view-link rv-back-button" onClick={onBack}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Back to cost rollup
      </button>
    </div>
  );
}

export function DrillDown({ port, brand, clipboard, session, onBack }: { port: AppHostPort; brand: ViewBrand; clipboard: ClipboardPort | undefined; session: SessionRef; onBack: () => void }) {
  const { sessionId, providerId } = session;
  const { state, load } = useResource<SessionCost>(
    async () => {
      const found = await callParsed(port, "get_session_cost", { sessionId, provider: providerId }, parseSessionCost);
      // A result for another session would show the wrong figures.
      return found?.sessionId === sessionId ? found : undefined;
    },
    true,
    `${providerId}:${sessionId}`,
  );
  const result = useMemo(() => (state.status === "ready" ? { structuredContent: state.data } : undefined), [state]);
  const lead = <BackButton onBack={onBack} />;

  if (state.status === "ready") {
    return <SessionCostView port={port} brand={brand} clipboard={clipboard} result={result} frame={{ kicker: KICKER, lead, actions: <AskAboutSession port={port} sessionId={sessionId} /> }} />;
  }
  return (
    <ViewShell brand={brand} kicker={KICKER} title="Session cost" lead={lead}>
      {state.status === "error" ? (
        <ErrorBox title="Couldn't load this session." onRetry={load}>
          The get_session_cost call failed. Go back to the rollup, or retry.
        </ErrorBox>
      ) : (
        <p role="status" className="text-muted">
          Loading session…
        </p>
      )}
    </ViewShell>
  );
}
