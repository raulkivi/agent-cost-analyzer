// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Turn, VendorComparison, VendorComparisonEntry, VendorProfileSummary } from "@agent-cost-analyzer/domain";
import { aiCreditsToUsd, formatUsd } from "../../lib/ai-credits-usd.js";
import { CacheOutcomeBadge } from "./CacheOutcomeBadge.js";

// Only a simulated turn with something to compare: a cache event, or any
// outcome other than a plain hit.
export function hasCacheEvent(turn: Turn): boolean {
  const simulation = turn.simulation;
  if (simulation === undefined) return false;
  return turn.triggeredEvent !== undefined || simulation.cacheOutcome !== "hit";
}

interface VendorDifferencesCardProps {
  comparison: VendorComparison | null;
  turnIndex: number;
  profiles: VendorProfileSummary[];
}

function Credits({ value }: { value: number }) {
  return <span title={`≈ ${formatUsd(aiCreditsToUsd(value))}`}>{value.toFixed(2)}</span>;
}

function EntryRow({ entry, turnIndex, profiles }: { entry: VendorComparisonEntry } & Omit<VendorDifferencesCardProps, "comparison">) {
  const turn = entry.turns.find((candidate) => candidate.index === turnIndex);
  const sources = (profiles.find((profile) => profile.vendorId === entry.vendorId)?.sources ?? []).filter((source) =>
    turn?.sourceIds.includes(source.id),
  );
  return (
    <li className="vendor-diff-row">
      <span className="vendor-diff-model">{entry.displayName}</span>
      {!entry.simulated || turn === undefined ? (
        <span className="text-muted vendor-diff-note">{entry.reason ?? "This turn isn't simulated on this model."}</span>
      ) : (
        <>
          <span className="vendor-diff-outcome">
            <CacheOutcomeBadge outcome={turn.cacheOutcome} />
          </span>
          <span className="vendor-diff-credits">
            {turn.aiCredits.known ? <Credits value={turn.aiCredits.value} /> : <span className="text-muted">unavailable</span>}
          </span>
          <span className="vendor-diff-note">{turn.note}</span>
          {sources.length > 0 && (
            <span className="vendor-diff-sources">
              {sources.map((source) => (
                <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
              ))}
            </span>
          )}
        </>
      )}
    </li>
  );
}

// Rows are a wrapping flex list, not a table, so each vendor stacks into a
// block at narrow panel widths (10.11).
export function VendorDifferencesCard({ comparison, turnIndex, profiles }: VendorDifferencesCardProps) {
  if (comparison === null) return null;
  const defaults = new Set(profiles.map((profile) => `${profile.vendorId}/${profile.defaultModelId}`));
  const entries = comparison.entries.filter((entry) => defaults.has(`${entry.vendorId}/${entry.modelId}`));
  if (entries.length === 0) return null;
  return (
    <section className="vendor-diff" aria-labelledby="vendor-diff-title">
      <h3 id="vendor-diff-title" className="vendor-diff-title">
        How vendors differ
      </h3>
      <ul className="vendor-diff-list">
        {entries.map((entry) => (
          <EntryRow key={entry.modelId} entry={entry} turnIndex={turnIndex} profiles={profiles} />
        ))}
      </ul>
    </section>
  );
}
