import { useCallback, useId, useState } from "react";
import type { CostEstimate } from "@agent-cost-analyzer/domain";
import { fetchCostEstimate, type EstimateQuery } from "../../api-client/statements.js";
import { useCancellableLoad } from "../../lib/use-cancellable-load.js";
import { AsyncView, cancelledEmptyState } from "../ui/AsyncView.js";
import { Blueprint } from "../ui/Blueprint.js";
import { SegmentedControl } from "../ui/SegmentedControl.js";

// Phase 15 step 15.12 (plan §8.6, §11.5; board 4): the Billing tab's
// estimate panel. Planned active days and a 4- or 12-week history; the
// forecast is a range (p50 to p90) on a horizontal interval with both ends
// labelled, plus the inputs it used, labelled "Estimate" at today's prices
// and never one number. Thin history gives the reason instead (D18); the
// other-model reprice comes with Phase 14 (D17). Amounts in AI Credits with
// USD beside them (1 AI Credit = $0.01).

const WINDOWS = [
  { value: "4", label: "4 weeks" },
  { value: "12", label: "12 weeks" },
] as const;

const credits = (usd: number) => (usd * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dollars = (usd: number) => `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface EstimatePanelProps {
  projectId: string;
  loadEstimate?: (query: EstimateQuery, signal: AbortSignal) => Promise<CostEstimate>;
}

export function EstimatePanel({ projectId, loadEstimate = fetchCostEstimate }: EstimatePanelProps) {
  const [days, setDays] = useState(20);
  const [weeks, setWeeks] = useState<"4" | "12">("12");
  const titleId = useId();
  const valid = Number.isInteger(days) && days >= 1;
  const load = useCallback(
    (signal: AbortSignal) => loadEstimate({ projectId, activeDays: days, historyWeeks: Number(weeks) as 4 | 12 }, signal),
    [projectId, days, weeks, loadEstimate],
  );
  const { state, cancel, retry } = useCancellableLoad(load, valid);

  return (
    <Blueprint className="audit-section">
      <section aria-labelledby={titleId} className="estimate-panel">
        <div className="card-kicker">Estimate · at today's prices</div>
        <h4 id={titleId} className="cost-chart-title">
          Next piece of work
        </h4>
        <div className="projects-row">
          <label className="field">
            <span>Planned active days</span>
            <input className="input" type="number" min={1} value={Number.isNaN(days) ? "" : days} onChange={(event) => setDays(event.target.valueAsNumber)} />
          </label>
          <div className="cost-filter" role="radiogroup" aria-label="History window">
            <SegmentedControl name="estimate-weeks" options={WINDOWS} value={weeks} onChange={setWeeks} />
          </div>
        </div>
        {!valid ? (
          <p className="cost-note">Enter a whole number of days, 1 or more.</p>
        ) : (
          <AsyncView
            status={state.kind === "ready" ? "ready" : state.kind === "cancelled" ? "empty" : state.kind}
            loadingText="Working out the estimate…"
            onCancel={cancel}
            error={state.kind === "error" ? { title: `Could not estimate: ${state.message}`, onRetry: retry } : undefined}
            empty={cancelledEmptyState(retry)}
          >
            {state.kind === "ready" && <EstimateBody estimate={state.data} />}
          </AsyncView>
        )}
        <p className="text-muted cost-note">On another model: with Phase 14 (replaying sessions on another vendor).</p>
      </section>
    </Blueprint>
  );
}

function EstimateBody({ estimate }: { estimate: CostEstimate }) {
  const { range, unitCost, history, window } = estimate;
  if (range === null || unitCost === null) return <p className="cost-note">{estimate.refusal}</p>;
  const left = history.units - history.knownUnits;
  const unitWord = estimate.unit === "activeDays" ? "active day" : "session";
  const label = `Estimate at today's prices: ${credits(range.p50)} to ${credits(range.p90)} AI Credits (${dollars(range.p50)} to ${dollars(range.p90)}), p50 to p90.`;
  // p50 at a fixed place and p90 placed by how much larger it is, so a wide range reads wide.
  const width = 360;
  const x50 = 80;
  const x90 = range.p90 === 0 ? x50 : x50 + ((width - 160) * (range.p90 - range.p50)) / range.p90 + 20;
  return (
    <figure className="estimate-figure">
      <svg role="img" aria-label={label} viewBox={`0 0 ${width} 70`} width="100%" className="estimate-interval">
        <line x1={8} x2={width - 8} y1={34} y2={34} className="waterfall-axis" />
        <rect x={x50} y={26} width={Math.max(2, x90 - x50)} height={16} rx={4} className="estimate-band" />
        <line x1={x50} x2={x50} y1={20} y2={48} className="estimate-end" />
        <line x1={x90} x2={x90} y1={20} y2={48} className="estimate-end" />
        <text x={x50} y={14} textAnchor="middle" className="waterfall-value">
          p50 {credits(range.p50)}
        </text>
        <text x={x90} y={14} textAnchor="middle" className="waterfall-value">
          p90 {credits(range.p90)}
        </text>
        <text x={(x50 + x90) / 2} y={62} textAnchor="middle" className="waterfall-name">
          AI Credits · {dollars(range.p50)} – {dollars(range.p90)}
        </text>
      </svg>
      <figcaption className="cost-note">
        A range, never one number. From {history.knownUnits} {unitWord}s with a known cost, {window.since} to {window.until}
        {left > 0 ? ` (${left} left out)` : ""}: cost per {unitWord} median {credits(unitCost.p50)}, p90 {credits(unitCost.p90)} AI Credits.
      </figcaption>
    </figure>
  );
}
