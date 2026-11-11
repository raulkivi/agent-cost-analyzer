// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useMemo, useState } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../host/app-host-port.js";
import { toReplayViewModel } from "../view-models/index.js";
import type { ReplayCompareViewModel, ReplayDetailViewModel } from "../view-models/index.js";
import { ErrorBox } from "./SessionCostView.js";
import { ViewShell } from "./ViewShell.js";
import { Callout } from "./replay/Callout.js";
import { CompareRows } from "./replay/CompareRows.js";
import { ReplayDetail, SimulatedTag } from "./replay/ReplayDetail.js";
import { ReplayDrillDown } from "./replay/ReplayDrillDown.js";
import { parseReplay } from "./replay/parse-replay.js";
import "./replay/replay.css";

// U12, a session replayed on another model (plan §4.5, board Replay.dc.html,
// owner answers §9.2 Q1-Q5). Renders compare_models_for_session (compare
// mode) and replay_session (replay mode). A model in compare mode calls
// replay_session through the port and swaps to replay mode in place; this view
// stays mounted, so Back refetches nothing. Every simulated figure says
// Simulated, and an unknown one reads Unknown, never 0.

const FALLBACK_KICKER = "Session replay";
const COMPARE_KICKER = "Replay on other models";

function Compare({ port, brand, vm }: { port: AppHostPort; brand: ViewBrand; vm: ReplayCompareViewModel }) {
  const [selected, setSelected] = useState<string | undefined>();
  // The model last opened, so Back can return focus to its button.
  const [returnTo, setReturnTo] = useState<string | undefined>();
  if (selected !== undefined) {
    return <ReplayDrillDown port={port} brand={brand} target={{ sessionId: vm.sessionId, providerId: vm.providerId, model: selected }} onBack={() => setSelected(undefined)} />;
  }
  const check = vm.ownModelCheck;
  const meta = `Session ${vm.sessionId} · ${vm.turnsText}${vm.measuredModel === undefined ? "" : ` · measured on ${vm.measuredModel}`}`;
  return (
    <ViewShell brand={brand} kicker={COMPARE_KICKER} title="Replay on other models" meta={meta} titleTag={<SimulatedTag />}>
      <Callout tone={check.status === "shown" ? "ok" : "warn"} title={check.status === "shown" ? "Own-model check:" : "No own-model check."} alert={check.callout}>
        {check.status === "shown" ? check.text : check.text.replace(/^No own-model check: /, "")}
      </Callout>
      <section className="view-section" aria-label="Would have cost about">
        <div className="view-section-head">
          <h2>Would have cost about</h2>
          <span className="text-muted">click a model to replay it turn by turn</span>
        </div>
        <CompareRows
          vm={vm}
          focusOnMount={returnTo}
          onOpen={(model) => {
            setSelected(model);
            setReturnTo(model);
          }}
        />
        <ul className="rp-legend" aria-label="Chart key">
          <li>
            <span className="rp-swatch rp-swatch--measured" aria-hidden="true" />
            measured, from the log
          </li>
          <li>
            <span className="rp-swatch rp-swatch--simulated" aria-hidden="true" />
            simulated
          </li>
          <li className="text-muted">sign: change against measured · ≥ means a floor</li>
        </ul>
      </section>
      <p className="rp-basis text-muted">The same conversation and token counts are assumed; cache behaviour is replayed per model. Figures are simulated, not what was billed.</p>
    </ViewShell>
  );
}

export function ReplayView({ port, brand, result }: { port: AppHostPort; brand: ViewBrand; result: ToolResult | undefined }) {
  const parsed = useMemo(() => (result === undefined || result.isError ? undefined : parseReplay(result.structuredContent)), [result]);
  const vm = useMemo(() => (parsed === undefined ? undefined : toReplayViewModel(parsed)), [parsed]);

  if (result === undefined) {
    return (
      <ViewShell brand={brand} kicker={FALLBACK_KICKER} title="Session replay">
        <p role="status" className="text-muted">
          Waiting for the replay…
        </p>
      </ViewShell>
    );
  }
  if (result.isError) {
    const text = result.errorText?.trim();
    return (
      <ViewShell brand={brand} kicker={FALLBACK_KICKER} title="Session replay">
        <ErrorBox title="Couldn't load the replay.">{text === undefined || text === "" ? "The tool returned an error. The text answer above is complete." : `The tool returned an error: ${text.slice(0, 500)}`}</ErrorBox>
      </ViewShell>
    );
  }
  if (vm === undefined) {
    return (
      <ViewShell brand={brand} kicker={FALLBACK_KICKER} title="Session replay">
        <ErrorBox title="Couldn't load the replay.">The result is one this view can&apos;t read. The text answer above is complete.</ErrorBox>
      </ViewShell>
    );
  }
  if (vm.mode === "compare") return <Compare port={port} brand={brand} vm={vm} />;
  return <ReplayDetail brand={brand} vm={vm as ReplayDetailViewModel} kicker={FALLBACK_KICKER} />;
}
