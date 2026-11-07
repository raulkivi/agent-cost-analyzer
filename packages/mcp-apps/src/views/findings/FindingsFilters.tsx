// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { FindingKind, FindingSeverity } from "@agent-cost-analyzer/domain";
import { SegmentedControl } from "@agent-cost-analyzer/web/ui/SegmentedControl";
import type { FilterOption } from "../../view-models/findings.js";
import "./findings.css";

interface FindingsFiltersProps {
  kindOptions: FilterOption<FindingKind>[];
  severityOptions: FilterOption<FindingSeverity>[];
  onKind: (kind: FindingKind | "all") => void;
  onMinSeverity: (severity: FindingSeverity | "all") => void;
}

const selectedValue = <V extends string>(options: FilterOption<V>[]): V | "all" =>
  options.find((option) => option.selected && option.value !== "all")?.value ?? "all";

export function FindingsFilters({ kindOptions, severityOptions, onKind, onMinSeverity }: FindingsFiltersProps) {
  return (
    <div className="fv-filters">
      <div role="radiogroup" aria-label="Kind">
        <SegmentedControl
          name="findings-kind"
          options={kindOptions.map(({ value, label }) => ({ value, label }))}
          value={selectedValue(kindOptions)}
          onChange={onKind}
        />
      </div>
      <label className="fv-select">
        <span className="fv-muted">Severity</span>
        <select value={selectedValue(severityOptions)} onChange={(event) => onMinSeverity(event.target.value as FindingSeverity | "all")}>
          {severityOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
