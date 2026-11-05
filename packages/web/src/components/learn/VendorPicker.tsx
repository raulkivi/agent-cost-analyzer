import type { VendorProfileSummary } from "@agent-cost-analyzer/domain";

interface VendorPickerProps {
  profiles: VendorProfileSummary[];
  value: string;
  onChange(modelId: string): void;
  disabled?: boolean;
}

const reasonId = (modelId: string): string => `vendor-picker-reason-${modelId}`;

// A native select keeps keyboard and screen-reader behaviour for free. A
// model that isn't simulated stays listed but disabled, with its reason,
// so the user sees why instead of a missing vendor (D1).
export function VendorPicker({
  profiles,
  value,
  onChange,
  disabled,
}: VendorPickerProps) {
  const unsimulated = profiles.flatMap((profile) =>
    profile.models.filter((model) => !model.simulated),
  );

  return (
    <div className="vendor-picker view-select">
      <label htmlFor="vendor-picker-select">Simulate on</label>
      <select
        id="vendor-picker-select"
        className="input vendor-picker-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {profiles.map((profile) => (
          <optgroup key={profile.vendorId} label={profile.displayName}>
            {profile.models.map((model) => (
              <option
                key={model.modelId}
                value={model.modelId}
                disabled={!model.simulated}
                title={model.reason}
                aria-describedby={
                  model.simulated ? undefined : reasonId(model.modelId)
                }
              >
                {model.simulated
                  ? model.displayName
                  : `${model.displayName} (not simulated)`}
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
