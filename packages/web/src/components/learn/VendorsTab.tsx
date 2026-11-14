// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useState, type ReactNode } from "react";
import type { VendorComparison, VendorComparisonEntry, VendorProfileSummary } from "@agent-cost-analyzer/domain";
import { aiCreditsToUsd, formatUsd } from "../../lib/ai-credits-usd.js";
import { entryStats, sortEntries, type SortDirection, type SortKey } from "../../lib/comparison-stats.js";
import { CacheOutcomeBadge } from "./CacheOutcomeBadge.js";

interface VendorsTabProps {
  comparison: VendorComparison;
  profiles: VendorProfileSummary[];
  // Models the user added on top of each vendor's default (D11).
  extraModelIds: string[];
  onAddModel(modelId: string): void;
  onRemoveModel(modelId: string): void;
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "model", label: "Model" },
  { key: "total", label: "Total AI credits" },
  { key: "usd", label: "USD" },
  { key: "hit", label: "Cache hits" },
  { key: "misses", label: "Misses" },
  { key: "expensive", label: "Most expensive turn" },
];

const UNAVAILABLE = <span className="text-muted">unavailable</span>;

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="vendors-figure">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ModelBlock({ entry, removable, onRemove }: { entry: VendorComparisonEntry; removable: boolean; onRemove(): void }) {
  const stats = entryStats(entry);
  return (
    <li className="vendors-block">
      <div className="vendors-model">
        <h3 className="vendors-name">{entry.displayName}</h3>
        {removable && (
          <button type="button" className="btn btn-ghost" aria-label={`Remove ${entry.displayName}`} onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {entry.simulated ? (
        <div className="vendors-strip">
          {entry.turns.map((turn) => (
            <span key={turn.index} className="vendors-strip-mark" title={`Turn ${turn.index}`}>
              <CacheOutcomeBadge outcome={turn.cacheOutcome} />
            </span>
          ))}
        </div>
      ) : (
        <div className="text-muted vendors-reason">{entry.reason}</div>
      )}
      <dl className="vendors-figures">
        <Figure label="Total AI credits">{stats.totalCredits === null ? UNAVAILABLE : stats.totalCredits.toFixed(2)}</Figure>
        <Figure label="USD">{stats.totalCredits === null ? UNAVAILABLE : formatUsd(aiCreditsToUsd(stats.totalCredits))}</Figure>
        <Figure label="Cache hits">{stats.hitRatio === null ? UNAVAILABLE : `${Math.round(stats.hitRatio * 100)}%`}</Figure>
        <Figure label="Misses">{entry.simulated ? stats.misses : UNAVAILABLE}</Figure>
        <Figure label="Most expensive turn">
          {stats.mostExpensive === null
            ? UNAVAILABLE
            : `Turn ${stats.mostExpensive.index} (${stats.mostExpensive.credits.toFixed(2)})`}
        </Figure>
      </dl>
    </li>
  );
}

// D11/D19: each simulated vendor's default model plus the models the user
// added, side by side; every figure also in USD. One block per model
// (name, per-turn strip, labelled figures) so the ~290px side column never
// scrolls sideways; sorting is a select plus a direction button.
export function VendorsTab({ comparison, profiles, extraModelIds, onAddModel, onRemoveModel }: VendorsTabProps) {
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const [candidate, setCandidate] = useState("");
  const shown = new Set(comparison.entries.map((entry) => entry.modelId));
  const addable = profiles
    .map((profile) => ({
      profile,
      models: profile.models.filter((model) => model.simulated && !shown.has(model.modelId)),
    }))
    .filter((group) => group.models.length > 0);
  const entries = sort === null ? comparison.entries : sortEntries(comparison.entries, sort.key, sort.direction);

  return (
    <div className="vendors-tab">
      <div className="vendors-sort view-select">
        <label htmlFor="vendors-sort-select">Sort by</label>
        <select
          id="vendors-sort-select"
          className="input"
          value={sort?.key ?? ""}
          onChange={(event) => {
            const key = event.target.value as SortKey | "";
            setSort(key === "" ? null : { key, direction: "asc" });
          }}
        >
          <option value="">Default order</option>
          {SORT_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        {sort !== null && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setSort({ key: sort.key, direction: sort.direction === "asc" ? "desc" : "asc" })}
          >
            {sort.direction === "asc" ? "Ascending" : "Descending"}
          </button>
        )}
      </div>
      <ul className="vendors-list" aria-label="Scenario simulated on each vendor's models">
        {entries.map((entry) => (
          <ModelBlock
            key={entry.modelId}
            entry={entry}
            removable={extraModelIds.includes(entry.modelId)}
            onRemove={() => onRemoveModel(entry.modelId)}
          />
        ))}
      </ul>
      {addable.length > 0 && (
        <div className="vendors-add view-select">
          <label htmlFor="vendors-add-select">Add a model</label>
          <select
            id="vendors-add-select"
            className="input vendor-picker-select"
            value={candidate}
            onChange={(event) => setCandidate(event.target.value)}
          >
            <option value="">Choose…</option>
            {addable.map(({ profile, models }) => (
              <optgroup key={profile.vendorId} label={profile.displayName}>
                {models.map((model) => (
                  <option key={model.modelId} value={model.modelId}>
                    {model.displayName}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={candidate === ""}
            onClick={() => {
              onAddModel(candidate);
              setCandidate("");
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
