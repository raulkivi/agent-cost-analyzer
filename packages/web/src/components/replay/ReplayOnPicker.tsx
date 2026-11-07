// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId } from "react";
import type { VendorProfileSummary } from "@agent-cost-analyzer/domain";
import { profileModelIdFor } from "../../lib/replay-models.js";

interface ReplayOnPickerProps {
  profiles: VendorProfileSummary[];
  // null: Off, measured figures only.
  value: string | null;
  // The session's own model, as its log spells it; marked "(this session)".
  sessionModel: string;
  onChange(modelId: string | null): void;
  // Why this session can't be replayed (board 4c); the picker is disabled.
  unavailableReason?: string;
}

const OFF = "";

// Learn's VendorPicker, for a real session (plan §3): vendors grouped, a
// model with undocumented caching listed but disabled with its reason
// (Phase 13 D1), and an Off choice first. A native select keeps keyboard and
// screen-reader behaviour for free.
export function ReplayOnPicker({ profiles, value, sessionModel, onChange, unavailableReason }: ReplayOnPickerProps) {
  const id = useId();
  const ownModel = profileModelIdFor(sessionModel, profiles);
  const unavailableId = `${id}-unavailable`;
  const reasonId = (modelId: string) => `${id}-reason-${modelId}`;
  const unsimulated = profiles.flatMap((profile) => profile.models.filter((model) => !model.simulated));

  return (
    <div className="vendor-picker view-select replay-on-picker">
      <label htmlFor={`${id}-select`}>Replay on</label>
      <select
        id={`${id}-select`}
        className="input vendor-picker-select"
        value={unavailableReason ? OFF : (value ?? OFF)}
        disabled={unavailableReason !== undefined}
        aria-describedby={unavailableReason ? unavailableId : undefined}
        onChange={(event) => onChange(event.target.value === OFF ? null : event.target.value)}
      >
        <option value={OFF}>{unavailableReason ? "Not available" : "Off (measured only)"}</option>
        {!unavailableReason &&
          profiles.map((profile) => (
            <optgroup key={profile.vendorId} label={profile.displayName}>
              {profile.models.map((model) => (
                <option
                  key={model.modelId}
                  value={model.modelId}
                  disabled={!model.simulated}
                  title={model.reason}
                  aria-describedby={model.simulated ? undefined : reasonId(model.modelId)}
                >
                  {!model.simulated
                    ? `${model.displayName} (not simulated)`
                    : model.modelId === ownModel
                      ? `${model.displayName} (this session)`
                      : model.displayName}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
      {unavailableReason ? (
        <span id={unavailableId} className="text-muted replay-on-reason">
          {unavailableReason}
        </span>
      ) : (
        unsimulated.map((model) => (
          <span key={model.modelId} id={reasonId(model.modelId)} className="sr-only">
            {model.reason}
          </span>
        ))
      )}
    </div>
  );
}
