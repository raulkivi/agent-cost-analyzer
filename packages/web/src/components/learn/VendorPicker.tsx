// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { VendorProfileSummary } from "@agent-cost-analyzer/domain";

interface VendorPickerProps {
  profiles: VendorProfileSummary[];
  value: string;
  onChange(modelId: string): void;
  disabled?: boolean;
  // Learn's "Simulate on" and its fixed ids unless given (step 14.7 reuses
  // the picker as Replay on and as Compare models' Add model).
  label?: string;
  id?: string;
  // A first choice whose value is "" (Off, Choose…).
  placeholder?: string;
  // Models not to list; a vendor with none left is left out too.
  excludeModelIds?: readonly string[];
  // One model listed as "<name> (<note>)", e.g. the session's own.
  markedModel?: { modelId: string; note: string };
  describedBy?: string;
  className?: string;
}

const DEFAULT_ID = "vendor-picker-select";

// A native select keeps keyboard and screen-reader behaviour for free. A
// model that isn't simulated stays listed but disabled, with its reason,
// so the user sees why instead of a missing vendor (D1).
export function VendorPicker({
  profiles,
  value,
  onChange,
  disabled,
  label = "Simulate on",
  id,
  placeholder,
  excludeModelIds = [],
  markedModel,
  describedBy,
  className,
}: VendorPickerProps) {
  const selectId = id ?? DEFAULT_ID;
  const reasonId = (modelId: string): string =>
    `${id === undefined ? "vendor-picker" : id}-reason-${modelId}`;
  const excluded = new Set(excludeModelIds);
  const groups = profiles
    .map((profile) => ({
      profile,
      models: profile.models.filter((model) => !excluded.has(model.modelId)),
    }))
    .filter((group) => group.models.length > 0);
  const unsimulated = groups.flatMap((group) =>
    group.models.filter((model) => !model.simulated),
  );
  const optionText = (model: VendorProfileSummary["models"][number]): string => {
    if (!model.simulated) return `${model.displayName} (not simulated)`;
    if (markedModel?.modelId === model.modelId) return `${model.displayName} (${markedModel.note})`;
    return model.displayName;
  };

  return (
    <div className={["vendor-picker", "view-select", className].filter(Boolean).join(" ")}>
      <label htmlFor={selectId}>{label}</label>
      <select
        id={selectId}
        className="input vendor-picker-select"
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {groups.map(({ profile, models }) => (
          <optgroup key={profile.vendorId} label={profile.displayName}>
            {models.map((model) => (
              <option
                key={model.modelId}
                value={model.modelId}
                disabled={!model.simulated}
                title={model.reason}
                aria-describedby={
                  model.simulated ? undefined : reasonId(model.modelId)
                }
              >
                {optionText(model)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {unsimulated.map((model) => (
        <span
          key={model.modelId}
          id={reasonId(model.modelId)}
          className="sr-only"
        >
          {model.reason}
        </span>
      ))}
    </div>
  );
}
