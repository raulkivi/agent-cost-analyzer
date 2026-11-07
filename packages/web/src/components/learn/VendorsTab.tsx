// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useState } from "react";
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

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "model", label: "Model" },
  { key: "total", label: "Total AI credits" },
  { key: "usd", label: "USD" },
  { key: "hit", label: "Cache hits" },
  { key: "misses", label: "Misses" },
  { key: "expensive", label: "Most expensive turn" },
];

const UNAVAILABLE = <span className="text-muted">unavailable</span>;

function Row({ entry, removable, onRemove }: { entry: VendorComparisonEntry; removable: boolean; onRemove(): void }) {
  const stats = entryStats(entry);
  return (
    <tr>
      <td>
        <div className="vendors-model">
          <span>{entry.displayName}</span>
          {removable && (
            <button
              type="button"
              className="btn btn-ghost"
              aria-label={`Remove ${entry.displayName}`}
              onClick={onRemove}
            >
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
      </td>
      <td>{stats.totalCredits === null ? UNAVAILABLE : stats.totalCredits.toFixed(2)}</td>
      <td>{stats.totalCredits === null ? UNAVAILABLE : formatUsd(aiCreditsToUsd(stats.totalCredits))}</td>
      <td>{stats.hitRatio === null ? UNAVAILABLE : `${Math.round(stats.hitRatio * 100)}%`}</td>
      <td>{entry.simulated ? stats.misses : UNAVAILABLE}</td>
      <td>
        {stats.mostExpensive === null
          ? UNAVAILABLE
          : `Turn ${stats.mostExpensive.index} (${stats.mostExpensive.credits.toFixed(2)})`}
      </td>
    </tr>
  );
}

// D11/D19: each simulated vendor's default model plus the models the user
// added, side by side; every figure also in USD. A table first (10.11); the
// per-turn strip sits under the model name so narrow panels scroll one axis.
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

  function toggleSort(key: SortKey): void {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  }

  return (
    <div className="vendors-tab">
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">Scenario simulated on each vendor's models</caption>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={sort?.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                >
                  <button type="button" className="btn btn-ghost vendors-sort" onClick={() => toggleSort(column.key)}>
                    {column.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <Row
                key={entry.modelId}
                entry={entry}
                removable={extraModelIds.includes(entry.modelId)}
                onRemove={() => onRemoveModel(entry.modelId)}
              />
            ))}
          </tbody>
        </table>
      </div>
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
