// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { StatTile } from "@agent-cost-analyzer/web/ui/StatTile";
import { Tag } from "@agent-cost-analyzer/web/ui/Tag";
import { formatAiCreditsValue } from "@agent-cost-analyzer/web/lib/format-ai-credits";
import { useMemo } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../host/app-host-port.js";
import type { ClipboardPort } from "../host/clipboard-port.js";
import { toSessionCostViewModel } from "../view-models/index.js";
import type { SessionCostTile } from "../view-models/index.js";
import { ViewShell } from "./ViewShell.js";
import { ContextOverhead } from "./session-cost/ContextOverhead.js";
import { CopyCommandButton, CopyCommandStatus, useCopyCommand } from "./session-cost/CopyCommandButton.js";
import { TopTurns } from "./session-cost/TopTurns.js";
import { TurnChart } from "./session-cost/TurnChart.js";
import { openSessionCommand } from "./session-cost/open-command.js";
import { callParsed, parseSessionCost, parseTurnSeries, useResource } from "./session-cost/tool-data.js";
import type { SessionCost, TurnSeries } from "@agent-cost-analyzer/domain";

// U1, session cost (docs/plans/mcp-apps.md §4.3, §5.5). Renders the
// get_session_cost result, fetches the per-turn series for the chart through
// the port, and expands a top turn through get_turn. Nothing logged is ever
// sent to the model (§6): this view calls no sendMessage and no
// updateModelContext, and the copy button copies a fixed command with an id.

const KICKER = "Session cost";

function Tile({ label, tile }: { label: string; tile: SessionCostTile }) {
  const note =
    tile.coverageNote !== undefined || tile.estimate ? (
      <>
        {tile.coverageNote}
        {tile.coverageNote !== undefined && tile.estimate ? " " : null}
        {tile.estimate && <Tag variant="outline" className="view-estimate" title="Estimated: the log has no usage figure for some turns">estimate</Tag>}
      </>
    ) : undefined;
  return <StatTile label={label} value={tile.text} note={note} />;
}

function ErrorBox({ title, children, onRetry }: { title: string; children: string; onRetry?: () => void }) {
  return (
    <div className="view-error" role="alert">
      <div>
        <b>{title}</b> <span>{children}</span>
        {onRetry !== undefined && (
          <div className="view-error-action">
            <button type="button" className="btn btn-secondary view-btn" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LoadedSessionCost({ port, brand, clipboard, cost }: { port: AppHostPort; brand: ViewBrand; clipboard: ClipboardPort | undefined; cost: SessionCost }) {
  const provider = cost.providerId;
  const series = useResource<TurnSeries>(
    async () => {
      const found = await callParsed(port, "get_turn_series", { sessionId: cost.sessionId, ...(provider === undefined ? {} : { provider }) }, parseTurnSeries);
      // A series for another session would draw the wrong turns.
      return found?.sessionId === cost.sessionId ? found : undefined;
    },
    true,
    cost.sessionId,
  );
  const seriesData = series.state.status === "ready" ? series.state.data : undefined;
  const vm = useMemo(() => toSessionCostViewModel(cost, seriesData), [cost, seriesData]);

  // The deep link is the extension's panel; the standalone product has none.
  const command = openSessionCommand(vm.sessionId);
  const copyable = clipboard !== undefined && brand.productId === "vscode-extension";
  const copy = useCopyCommand(clipboard ?? { writeText: () => Promise.resolve() }, command);

  const meta = [vm.model, vm.turnsText, vm.startedText].filter((part) => part !== undefined).join(" · ");
  const chartNotes = [vm.chart?.unknownNote, vm.chart?.truncatedNote].filter((note) => note !== undefined);

  return (
    <ViewShell brand={brand} kicker={KICKER} title={vm.title} meta={meta} actions={copyable ? <CopyCommandButton phase={copy.phase} onCopy={copy.copy} /> : undefined}>
      <div className="stat-tiles view-tiles">
        <Tile label="AI Credits" tile={vm.tiles.aiCredits} />
        <Tile label="Input tokens" tile={vm.tiles.inputTokens} />
        <Tile label="Cache hit" tile={vm.tiles.cacheHit} />
        <Tile label="Output tokens" tile={vm.tiles.output} />
      </div>

      <section className="view-section" aria-label="AI Credits per turn">
        <div className="view-section-head">
          <h2>AI Credits per turn</h2>
          {chartNotes.length > 0 && <span className="text-muted">{chartNotes.join(" · ")}</span>}
        </div>
        {series.state.status === "loading" && <div className="view-skeleton" aria-busy="true" />}
        {series.state.status === "error" && (
          <ErrorBox title="Couldn't load the per-turn chart." onRetry={series.load}>
            The get_turn_series call failed. The figures above come from the tool result and still stand.
          </ErrorBox>
        )}
        {vm.chart !== undefined && <TurnChart chart={vm.chart} formatValue={formatAiCreditsValue} />}
      </section>

      <section className="view-section" aria-label="Top turns">
        <div className="view-section-head">
          <h2>Top turns</h2>
          <span className="text-muted">by AI Credits · click a turn for its detail</span>
        </div>
        <TopTurns port={port} sessionId={vm.sessionId} provider={provider} turns={vm.topTurns} />
      </section>

      <section className="view-section" aria-label="Context overhead">
        <div className="view-section-head">
          <h2>Context overhead</h2>
        </div>
        <ContextOverhead overhead={vm.contextOverhead} />
      </section>

      {copyable && <CopyCommandStatus phase={copy.phase} command={command} />}
    </ViewShell>
  );
}

export function SessionCostView({ port, brand, clipboard, result }: { port: AppHostPort; brand: ViewBrand; clipboard?: ClipboardPort | undefined; result: ToolResult | undefined }) {
  const cost = useMemo(() => (result === undefined || result.isError ? undefined : parseSessionCost(result.structuredContent)), [result]);

  if (result === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Session cost">
        <p role="status" className="text-muted">
          Waiting for the session cost…
        </p>
      </ViewShell>
    );
  }
  if (cost === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Session cost">
        <ErrorBox title="Couldn't load this session.">The tool returned an error or a result this view can't read. The text answer above is complete.</ErrorBox>
      </ViewShell>
    );
  }
  return <LoadedSessionCost port={port} brand={brand} clipboard={clipboard} cost={cost} />;
}
