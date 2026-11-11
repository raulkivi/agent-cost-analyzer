// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { StatTile } from "@agent-cost-analyzer/web/ui/StatTile";
import { formatAiCreditsValue } from "@agent-cost-analyzer/web/lib/format-ai-credits";
import { useMemo, useState } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../host/app-host-port.js";
import type { ClipboardPort } from "../host/clipboard-port.js";
import { toCostRollupViewModel } from "../view-models/index.js";
import type { MeasureView } from "../view-models/index.js";
import { ErrorBox } from "./SessionCostView.js";
import { ViewShell } from "./ViewShell.js";
import { FullscreenButton } from "./display-mode/FullscreenButton.js";
import { useDisplayMode } from "./display-mode/use-display-mode.js";
import { DailyChart } from "./cost-rollup/DailyChart.js";
import { DrillDown } from "./cost-rollup/DrillDown.js";
import type { SessionRef } from "./cost-rollup/DrillDown.js";
import { ShareBars } from "./cost-rollup/ShareBars.js";
import { TopSessions } from "./cost-rollup/TopSessions.js";
import { parseCostRollup } from "./cost-rollup/parse-rollup.js";
import "./cost-rollup/cost-rollup.css";

// U2, cost rollup (plan §4.3, §5.5). Renders the get_cost_rollup result.
// Clicking a top session calls get_session_cost through the port and swaps
// to U1 in place; the rollup stays here, so Back refetches nothing. Session
// titles are logged text: shown in the table, never sent to the host's
// model (§6). The only message sent names a session id.

const KICKER = "Cost rollup";

function Tile({ label, value }: { label: string; value: MeasureView }) {
  return <StatTile label={label} value={value.text} note={value.unknownNote ?? value.coverageNote} />;
}

export function CostRollupView({ port, brand, clipboard, result }: { port: AppHostPort; brand: ViewBrand; clipboard?: ClipboardPort | undefined; result: ToolResult | undefined }) {
  const rollup = useMemo(() => (result === undefined || result.isError ? undefined : parseCostRollup(result.structuredContent)), [result]);
  const vm = useMemo(() => (rollup === undefined ? undefined : toCostRollupViewModel(rollup)), [rollup]);
  const [selected, setSelected] = useState<SessionRef | undefined>();
  // The session last opened, so Back can return focus to its row (A14).
  const [returnTo, setReturnTo] = useState<SessionRef | undefined>();
  const display = useDisplayMode(port);

  if (result === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Cost rollup">
        <p role="status" className="text-muted">
          Waiting for the cost rollup…
        </p>
      </ViewShell>
    );
  }
  if (rollup === undefined || vm === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Cost rollup">
        <ErrorBox title="Couldn't load the cost rollup.">The tool returned an error or a result this view can't read. The text answer above is complete.</ErrorBox>
      </ViewShell>
    );
  }
  if (selected !== undefined) {
    return <DrillDown port={port} brand={brand} clipboard={clipboard} session={selected} onBack={() => setSelected(undefined)} />;
  }

  const providerLabels = new Map(rollup.byProvider.map((row) => [row.providerId, row.providerLabel]));
  return (
    <ViewShell
      brand={brand}
      kicker={KICKER}
      title="Cost rollup"
      meta={vm.periodText}
      displayMode={display.mode}
      actions={display.fullscreenOffered ? <FullscreenButton mode={display.mode} onToggle={display.toggleFullscreen} /> : undefined}
    >
      <div className="stat-tiles view-tiles">
        <Tile label="AI Credits" value={vm.tiles.aiCredits} />
        <Tile label="Sessions" value={vm.tiles.sessions} />
        <Tile label="Turns" value={vm.tiles.turns} />
        <Tile label="Cache hit" value={vm.tiles.cacheHit} />
      </div>

      <section className="view-section" aria-label="Daily spend">
        <div className="view-section-head">
          <h2>Daily spend</h2>
          <span className="text-muted">AI Credits</span>
        </div>
        <DailyChart daily={vm.daily} formatValue={formatAiCreditsValue} />
      </section>

      <div className="rv-two">
        <section className="view-section" aria-label="By model">
          <div className="view-section-head">
            <h2>By model</h2>
          </div>
          <ShareBars label="Spend by model" rows={vm.byModel} />
        </section>
        <section className="view-section" aria-label="By provider">
          <div className="view-section-head">
            <h2>By provider</h2>
          </div>
          <ShareBars label="Spend by provider" rows={vm.byProvider} />
        </section>
      </div>

      <section className="view-section" aria-label="Top sessions">
        <div className="view-section-head">
          <h2>Top sessions</h2>
          <span className="text-muted">{`by ${vm.rankingLabel} · click a session to open it here`}</span>
        </div>
        <TopSessions
          sessions={vm.topSessions}
          rankingLabel={vm.rankingLabel}
          providerLabels={providerLabels}
          focusOnMount={returnTo}
          onOpen={(session) => {
            const ref = { sessionId: session.sessionId, providerId: session.providerId };
            setSelected(ref);
            setReturnTo(ref);
          }}
        />
      </section>
    </ViewShell>
  );
}
