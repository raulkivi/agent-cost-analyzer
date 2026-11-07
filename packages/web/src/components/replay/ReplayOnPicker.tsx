// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId } from "react";
import type { VendorProfileSummary } from "@agent-cost-analyzer/domain";
import { profileModelIdFor } from "../../lib/replay-models.js";
import { VendorPicker } from "../learn/VendorPicker.js";

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
// (Phase 13 D1), the session's own model marked, and an Off choice first.
export function ReplayOnPicker({ profiles, value, sessionModel, onChange, unavailableReason }: ReplayOnPickerProps) {
  const id = useId();
  const ownModel = profileModelIdFor(sessionModel, profiles);
  const unavailableId = `${id}-unavailable`;

  return (
    <>
      <VendorPicker
        id={`${id}-select`}
        label="Replay on"
        className="replay-on-picker"
        profiles={unavailableReason ? [] : profiles}
        value={unavailableReason ? OFF : (value ?? OFF)}
        placeholder={unavailableReason ? "Not available" : "Off (measured only)"}
        markedModel={ownModel ? { modelId: ownModel, note: "this session" } : undefined}
        disabled={unavailableReason !== undefined}
        describedBy={unavailableReason ? unavailableId : undefined}
        onChange={(modelId) => onChange(modelId === OFF ? null : modelId)}
      />
      {unavailableReason && (
        <span id={unavailableId} className="text-muted replay-on-reason">
          {unavailableReason}
        </span>
      )}
    </>
  );
}
