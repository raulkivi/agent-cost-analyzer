// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useMemo, useRef } from "react";
import type { SessionCost } from "@agent-cost-analyzer/domain";
import type { ViewBrand } from "../../brand/view-brand.js";
import type { AppHostPort } from "../../host/app-host-port.js";
import type { ClipboardPort } from "../../host/clipboard-port.js";
import { ErrorBox, SessionCostView } from "../SessionCostView.js";
import { ViewShell } from "../ViewShell.js";
import { useFocusOnMountIfLost } from "../focus.js";
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

// What the drill-down returns to. U2 is the default; U9 names itself.
export interface DrillOrigin {
  kicker: string; // "Cost rollup › Session cost"
  backLabel: string; // "Back to cost rollup"
  parent: string; // "the rollup", as in "Go back to the rollup, or retry."
}

const ROLLUP_ORIGIN: DrillOrigin = { kicker: "Cost rollup › Session cost", backLabel: "Back to cost rollup", parent: "the rollup" };

// The session button that opened this view is gone once it opens, and the
// loading shell gives way to U1, so Back takes the lost focus each time it
// mounts (A14). The rollup puts focus back on the session row.
function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusOnMountIfLost(ref);
  return (
    <div className="rv-back">
      <button ref={ref} type="button" className="view-link rv-back-button" onClick={onBack}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        {label}
      </button>
    </div>
  );
}

export function DrillDown({
  port,
  brand,
  clipboard,
  session,
  onBack,
  origin = ROLLUP_ORIGIN,
}: {
  port: AppHostPort;
  brand: ViewBrand;
  clipboard: ClipboardPort | undefined;
  session: SessionRef;
  onBack: () => void;
  origin?: DrillOrigin;
}) {
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
  const lead = <BackButton onBack={onBack} label={origin.backLabel} />;

  if (state.status === "ready") {
    return <SessionCostView port={port} brand={brand} clipboard={clipboard} result={result} frame={{ kicker: origin.kicker, lead, actions: <AskAboutSession port={port} sessionId={sessionId} /> }} />;
  }
  return (
    <ViewShell brand={brand} kicker={origin.kicker} title="Session cost" lead={lead}>
      {state.status === "error" ? (
        <ErrorBox title="Couldn't load this session." onRetry={load}>
          {`The get_session_cost call failed. Go back to ${origin.parent}, or retry.`}
        </ErrorBox>
      ) : (
        <p role="status" className="text-muted">
          Loading session…
        </p>
      )}
    </ViewShell>
  );
}
