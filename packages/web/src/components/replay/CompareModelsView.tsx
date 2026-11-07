// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useId, useState, type CSSProperties } from "react";
import {
  MAX_COMPARED_MODELS,
  type Currency,
  type SessionReplayComparison,
  type VendorProfileSummary,
} from "@agent-cost-analyzer/domain";
import { ReplayCompareBars, type ReplayCompareBar } from "../../charts/ReplayCompareBars.js";
import { formatAmount, formatChange, UNKNOWN, unitLabel } from "../../lib/cost/cost-format.js";
import { useContainerWidth } from "../../lib/use-container-width.js";
import { useReplayComparison } from "../../state/use-replay-comparison.js";
import { AsyncView, cancelledEmptyState } from "../ui/AsyncView.js";
import { SegmentedControl } from "../ui/SegmentedControl.js";

type Pricing = "session-channel" | "copilot" | "api";

export interface CompareModelsViewProps {
  sessionId: string;
  providerId?: string;
  profiles: VendorProfileSummary[];
  initialModels: string[];
  pricing: Pricing;
  onPricingChange(pricing: Pricing): void;
}

type Entry = SessionReplayComparison["entries"][number];

// Below this width (the extension's compact panel) the bars go under the table.
const WIDE_MIN_PX = 720;
const MINUS = "−";

// Plan §6, worded for a person (the comparison carries none of its own).
const ASSUMPTIONS: { id: string; text: string; confidence: "unknown" | "inferred" }[] = [
  { id: "A1", confidence: "unknown", text: "Same conversation: the other model gets the same prompts and answers with as many output and reasoning tokens. It wouldn't; this is the main caveat." },
  { id: "A2", confidence: "unknown", text: "Same token counts: another vendor's tokenizer would count the same text differently; no text is read to count it again." },
  { id: "A3", confidence: "inferred", text: "Cold start: the first request reads nothing from the cache." },
  { id: "A4", confidence: "inferred", text: "Inferred cache writes where the log records none: they are what the vendor's caching rules say." },
  { id: "A5", confidence: "inferred", text: "Same harness: the session's tools, cache breakpoints and cache lifetimes are kept; only the model, its caching rules and prices change." },
];

const PRICING_OPTIONS: { value: Pricing; label: string }[] = [
  { value: "session-channel", label: "Session's channel" },
  { value: "copilot", label: "Copilot prices" },
  { value: "api", label: "API prices" },
];

const SIMULATED_BADGE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 18,
  padding: "0 6px",
  border: "1px dashed var(--color-accent-text)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-accent-text)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
const MEASURED_TAG: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 18,
  padding: "0 6px",
  border: "1px solid var(--color-text)",
  borderRadius: "var(--radius-sm)",
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
// The simulated columns: a dashed edge, as in the turns table's group.
const SIM_CELL: CSSProperties = {
  borderLeft: "1px dashed var(--color-accent)",
  borderRight: "1px dashed var(--color-accent)",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
const NUM: CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums" };
const BOX: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3) var(--space-4)",
  border: "1px solid var(--color-divider)",
  borderRadius: "var(--radius-md)",
  minWidth: 0,
};
const KICKER: CSSProperties = { fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-accent-text)" };

function SimulatedBadge() {
  return <span style={SIMULATED_BADGE}>Simulated</span>;
}

const distinct = (ids: readonly string[]): string[] => [...new Set(ids)];

// Highest simulated total first; an unknown total last, never as 0.
function rank(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.total.value === null || b.total.value === null) {
      return a.total.value === b.total.value ? a.model.localeCompare(b.model) : a.total.value === null ? 1 : -1;
    }
    return b.total.value - a.total.value || a.model.localeCompare(b.model);
  });
}

function difference(value: number | null, measured: number | null, currency: Currency): string {
  if (value === null || measured === null) return UNKNOWN;
  const diff = value - measured;
  const sign = diff < 0 ? MINUS : "+";
  const amount = `${sign}${formatAmount(Math.abs(diff), currency)}`;
  return measured === 0 ? amount : `${amount} (${formatChange(diff / measured)})`;
}

const unknownReason = (entry: Entry): string => (entry.replayedTurns > 0 ? "replayed, but not priced" : "not replayed");

function listModels(models: string[]): string {
  if (models.length <= 1) return models.join("");
  return `${models.slice(0, -1).join(", ")} and ${models[models.length - 1]}`;
}

function PricingNote({ pricing, data, vendorName }: { pricing: Pricing; data: SessionReplayComparison | null; vendorName(id: string): string }) {
  let lead: string;
  let rest: string | undefined;
  if (pricing === "copilot") {
    lead = "Priced at GitHub Copilot's prices as of the session's dates";
    rest = "every model in AI Credits, whatever channel the session used.";
  } else if (pricing === "api") {
    lead = "Priced at each model's vendor's API prices as of the session's dates";
    rest = "every model in USD, whatever channel the session used.";
  } else if (data === null) {
    lead = "Priced on the session's own channel as of its dates";
    rest = "a Copilot session at Copilot prices; any other on each model's own vendor's API.";
  } else if (data.currency === "AI_CREDITS") {
    lead = "Priced at GitHub Copilot's prices as of the session's dates";
    rest = "the session's own channel, for every model.";
  } else {
    const own = data.entries.find((entry) => entry.isMeasuredModel) ?? data.entries[0]!;
    const others = data.entries.filter((entry) => entry.vendorId !== own.vendorId).map((entry) => entry.model);
    lead = `Priced at the ${vendorName(own.vendorId)} API's prices as of the session's dates`;
    rest =
      others.length > 0
        ? `the session's own channel. ${listModels(others)} ${others.length === 1 ? "is" : "are"} priced at ${others.length === 1 ? "its" : "their"} own vendor's API prices as of the same dates: this session wasn't on Copilot, so on another vendor's model it moves to that vendor's API.`
        : "the session's own channel. This session wasn't on Copilot, so on another vendor's model it moves to that vendor's API.";
  }
  return (
    <div role="note" style={{ ...BOX, flexDirection: "row", padding: "var(--space-2) var(--space-3)", fontSize: 13 }}>
      <span aria-hidden="true" style={{ color: "var(--color-accent-text)" }}>
        ⓘ
      </span>
      <span>
        <strong>{lead}</strong>, <span className="text-muted">{rest}</span>
      </span>
    </div>
  );
}

interface AddModelPickerProps {
  profiles: VendorProfileSummary[];
  compared: readonly string[];
  disabled: boolean;
  describedBy: string;
  onAdd(modelId: string): void;
}

// Learn's VendorPicker grouping (vendors as optgroups, a model that isn't
// simulated listed but disabled, with its reason), as an "add" select: it
// starts on "Choose…", leaves out the models already compared, and adds on
// change.
function AddModelPicker({ profiles, compared, disabled, describedBy, onAdd }: AddModelPickerProps) {
  const id = useId();
  const shown = new Set(compared);
  const groups = profiles
    .map((profile) => ({ profile, models: profile.models.filter((model) => !shown.has(model.modelId)) }))
    .filter((group) => group.models.length > 0);
  const unsimulated = groups.flatMap((group) => group.models.filter((model) => !model.simulated));
  return (
    <div className="view-select">
      <label htmlFor={id}>Add model</label>
      <select
        id={id}
        className="input"
        value=""
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => {
          if (event.target.value !== "") onAdd(event.target.value);
        }}
      >
        <option value="">Choose…</option>
        {groups.map(({ profile, models }) => (
          <optgroup key={profile.vendorId} label={profile.displayName}>
            {models.map((model) => (
              <option
                key={model.modelId}
                value={model.modelId}
                disabled={!model.simulated}
                title={model.reason}
                aria-describedby={model.simulated ? undefined : `${id}-reason-${model.modelId}`}
              >
                {model.simulated ? model.displayName : `${model.displayName} (not simulated)`}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {unsimulated.map((model) => (
        <span key={model.modelId} id={`${id}-reason-${model.modelId}`} className="sr-only">
          {model.reason}
        </span>
      ))}
    </div>
  );
}

function Assumptions() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const inferred = ASSUMPTIONS.filter((assumption) => assumption.confidence === "inferred").length;
  const unknown = ASSUMPTIONS.length - inferred;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "var(--space-2)" }}>
      <button type="button" className="btn btn-secondary" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> Assumptions ({ASSUMPTIONS.length}) · {inferred} inferred, {unknown} unknown
      </button>
      {open && (
        <ul id={id} style={{ ...BOX, margin: 0, paddingLeft: "var(--space-8)", fontSize: 12 }}>
          {ASSUMPTIONS.map((assumption) => (
            <li key={assumption.id}>
              <strong>{assumption.id}</strong> {assumption.text} <span className="text-muted">({assumption.confidence})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ResultProps {
  data: SessionReplayComparison;
  wide: boolean;
  vendorName(id: string): string;
  onRemove(model: string): void;
}

function ComparisonResult({ data, wide, vendorName, onRemove }: ResultProps) {
  const tableTitleId = useId();
  const { currency } = data;
  const unit = unitLabel(currency);
  const entries = rank(data.entries);
  const own = data.entries.find((entry) => entry.isMeasuredModel);
  const measured = data.measured.value;
  const measuredText = formatAmount(measured, currency);
  const channel = (entry: Entry): string => (currency === "AI_CREDITS" ? "GitHub Copilot" : `${vendorName(entry.vendorId)} API`);
  const unknowns = entries.filter((entry) => entry.total.value === null);
  const zero = currency === "USD" ? "$0" : "0";
  const reference = own ?? entries[0]!;

  const bars: ReplayCompareBar[] = entries.map((entry) => ({
    key: entry.model,
    label: entry.model,
    sublabel: entry.isMeasuredModel ? "Measured model" : channel(entry),
    value: entry.total.value,
    isMeasuredModel: entry.isMeasuredModel,
    unknownReason: unknownReason(entry),
  }));

  const table = (
    <section aria-labelledby={tableTitleId} style={BOX}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "var(--space-3)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={KICKER}>Ranked by simulated total · highest first</span>
          <h3 id={tableTitleId} className="card-title" style={{ margin: 0 }}>
            This session on {entries.length} {entries.length === 1 ? "model" : "models"}
          </h3>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right", fontSize: 13 }}>
          <span className="text-muted">Measured{own ? ` on ${own.model}` : ""}</span>
          <br />
          <strong style={{ fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{measuredText}</strong>{" "}
          <span className="text-muted">
            over {data.measured.knownTurns} paired {data.measured.knownTurns === 1 ? "turn" : "turns"}
          </span>
        </div>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Models compared, table">
        <table className="table">
          <caption className="sr-only">
            Simulated cost of this session on each model, beside its measured cost of {measuredText}
          </caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Vendor</th>
              <th scope="col">Channel</th>
              <th scope="col" style={SIM_CELL}>
                <SimulatedBadge />
                <br />
                Total ({unit})
              </th>
              <th scope="col" style={SIM_CELL}>
                <SimulatedBadge />
                <br />
                vs measured
              </th>
              <th scope="col" style={NUM}>
                Turns replayed
              </th>
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.model}>
                <td style={entry.isMeasuredModel ? { boxShadow: "inset 3px 0 0 var(--color-text)" } : undefined}>
                  <span className="mono">{entry.model}</span>
                  {entry.isMeasuredModel && (
                    <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                      <span style={MEASURED_TAG}>Measured model</span>
                      <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>measured {measuredText}</span>
                    </span>
                  )}
                </td>
                <td>{vendorName(entry.vendorId)}</td>
                <td>{channel(entry)}</td>
                <td style={SIM_CELL} title={entry.total.value === null ? `No simulated total: ${unknownReason(entry)}` : `Simulated on ${entry.model}`}>
                  {entry.total.value === null ? <em>{UNKNOWN}</em> : formatAmount(entry.total.value, currency)}
                </td>
                <td style={SIM_CELL}>{difference(entry.total.value, measured, currency)}</td>
                <td style={NUM}>
                  {entry.replayedTurns} of {entry.total.turns}
                </td>
                <td>
                  {!entry.isMeasuredModel && (
                    <button type="button" className="btn btn-ghost" aria-label={`Remove ${entry.model} from the comparison`} onClick={() => onRemove(entry.model)}>
                      <span aria-hidden="true">✕</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unknowns.length > 0 && (
        <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
          {unknowns.map((entry) => `${entry.model} is ${unknownReason(entry)}`).join("; ")}: no simulated turn has a known price on this channel and date, so {unknowns.length === 1 ? "its total is" : "their totals are"} unknown, not {zero}.
        </p>
      )}
    </section>
  );

  const figure = (
    <figure style={{ ...BOX, margin: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={KICKER}>Simulated total · {unit}</span>
          <figcaption className="card-title">One bar per model</figcaption>
        </div>
        <SimulatedBadge />
      </div>
      <ReplayCompareBars ariaLabel="Simulated total per model" bars={bars} measured={measured} format={(value) => formatAmount(value, currency)} />
      <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
        One hue for every model; the session's own model is told apart by its hatching and outline. The axis starts at {zero}.
      </p>
    </figure>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div
        style={
          wide
            ? { display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "var(--space-4)", alignItems: "start" }
            : { display: "flex", flexDirection: "column", gap: "var(--space-4)" }
        }
      >
        {table}
        {figure}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "var(--space-4)", fontSize: 13 }}>
        <div style={{ ...BOX, flexDirection: "row", alignItems: "center", padding: "var(--space-2) var(--space-3)" }}>
          <span style={KICKER}>Coverage</span>
          <span>
            {reference.replayedTurns} of {reference.total.turns} turns replayed on {reference.model}
          </span>
        </div>
        <Assumptions />
      </div>
      <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
        Each figure is what this session would have cost about, had the same conversation run on that model (A1): another model would write other answers.
      </p>
    </div>
  );
}

// Phase 14 step 14.7 (D4, mock-up boards 3 to 5): the session's total on its
// own model and on others, simulated, beside what it really cost. The
// comparison is asked for again whenever the models or the price channel
// change; the session's own model is always in it (the server adds it).
export function CompareModelsView({ sessionId, providerId, profiles, initialModels, pricing, onPricingChange }: CompareModelsViewProps) {
  const [models, setModels] = useState<string[]>(() => distinct(initialModels).slice(0, MAX_COMPARED_MODELS));
  const [ownModel, setOwnModel] = useState<string | undefined>(undefined);
  const load = useReplayComparison(sessionId, providerId, models, pricing);
  const [measure, width] = useContainerWidth<HTMLElement>();
  const titleId = useId();
  const capId = useId();
  const pricingName = useId();
  const data = load.status === "ready" ? load.data : null;

  useEffect(() => {
    const own = data?.entries.find((entry) => entry.isMeasuredModel);
    if (own) setOwnModel(own.model);
  }, [data]);

  // What is compared: the session's own model (once known) and the asked-for ones.
  const compared = distinct([...(ownModel ? [ownModel] : []), ...(data?.entries.map((entry) => entry.model) ?? []), ...models]);
  const atCap = compared.length >= MAX_COMPARED_MODELS;
  const vendorName = (vendorId: string): string => profiles.find((profile) => profile.vendorId === vendorId)?.displayName ?? vendorId;
  const defaults = distinct([
    ...(ownModel ? [ownModel] : []),
    ...profiles
      .filter((profile) => profile.models.some((model) => model.modelId === profile.defaultModelId && model.simulated))
      .map((profile) => profile.defaultModelId),
  ]).slice(0, MAX_COMPARED_MODELS);
  const channelSuffix = data && pricing === "session-channel" ? (data.currency === "AI_CREDITS" ? " (Copilot)" : " (API)") : "";
  const pricingOptions = PRICING_OPTIONS.map((option) =>
    option.value === "session-channel" ? { ...option, label: `${option.label}${channelSuffix}` } : option,
  );

  const status = load.status === "ready" ? "ready" : load.status === "error" ? "error" : load.status === "loading" ? "loading" : "empty";
  const empty =
    load.status === "cancelled"
      ? cancelledEmptyState(load.retry)
      : { title: "No models to compare", body: "Add a model to see this session's simulated total on it." };

  return (
    <section ref={measure} aria-labelledby={titleId} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2) var(--space-3)" }}>
        <h2 id={titleId} className="card-title" style={{ margin: 0 }}>
          Compare models
        </h2>
        <SimulatedBadge />
        <span className="text-muted" style={{ fontSize: 13 }}>
          {data ? `${unitLabel(data.currency)}, ` : ""}the same turns on each model
        </span>
      </div>

      <div role="group" aria-label="Comparison settings" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2) var(--space-4)", fontSize: 13 }}>
        <AddModelPicker profiles={profiles} compared={compared} disabled={atCap} describedBy={capId} onAdd={(model) => setModels(distinct([...compared, model]))} />
        <span id={capId} style={{ fontVariantNumeric: "tabular-nums" }}>
          <strong>
            {compared.length} of {MAX_COMPARED_MODELS}
          </strong>{" "}
          <span className="text-muted">models, the session's own included</span>
        </span>
        <button type="button" className="btn btn-secondary" disabled={defaults.length === 0} onClick={() => setModels(defaults)}>
          Reset to each vendor's default
        </button>
        <div role="radiogroup" aria-label="Prices" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <span className="text-muted" aria-hidden="true">
            Prices
          </span>
          <SegmentedControl name={pricingName} options={pricingOptions} value={pricing} onChange={onPricingChange} />
        </div>
      </div>

      <PricingNote pricing={pricing} data={data} vendorName={vendorName} />

      <AsyncView
        status={status}
        loadingText={`Replaying this session on ${compared.length} ${compared.length === 1 ? "model" : "models"}…`}
        readyText="Comparison ready"
        skeleton="table"
        onCancel={load.cancel}
        empty={empty}
        error={{ title: "Couldn't compare models", details: load.error ?? undefined, onRetry: load.retry }}
      >
        {data && (
          <ComparisonResult
            data={data}
            wide={width === undefined || width >= WIDE_MIN_PX}
            vendorName={vendorName}
            onRemove={(model) => setModels(compared.filter((id) => id !== model))}
          />
        )}
      </AsyncView>
    </section>
  );
}
