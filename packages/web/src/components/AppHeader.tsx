// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { LogProviderDescriptor } from "@agent-cost-analyzer/domain";
import type { Mode } from "../state/session-store.js";
import { Blueprint } from "./ui/Blueprint.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";
import { Tag } from "./ui/Tag.js";

const MODE_OPTIONS = [
  { value: "learn", label: "Learn" },
  { value: "analyze", label: "Analyze" },
] as const;

interface AppHeaderProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  hasConfigWarnings: boolean;
  onConfigClick: () => void;
  // Analyze-mode-only log-provider select (architecture.md §4.2). Optional
  // so callers/tests that don't care about provider selection (or render
  // Learn mode) can omit them entirely.
  providers?: LogProviderDescriptor[];
  activeProviderId?: string;
  onProviderChange?: (id: string) => void;
  // Always-visible retention-threshold control (docs/plans/retention-
  // threshold-configurable.md) — unlike the provider select above, this is
  // not mode- or warning-gated. Optional so callers/tests that don't care
  // can omit them entirely.
  minRetainedSessionLogsThreshold?: number;
  onRetentionThresholdChange?: (value: number) => void;
  // From the ProductProfile (vscode-extension.md §3.3): the wordmark, and
  // whether the product offers a provider select at all (false when it has
  // exactly one provider). Omitted, the header looks as it always has.
  displayName?: string;
  providerSelect?: boolean;
  // True until the ProductProfile resolves or fails: the brand area stays
  // empty and there's no provider select, so the extension never flashes
  // the standalone wordmark or select first (step 10.7, found in 10.5).
  profilePending?: boolean;
  // Server health line; sits in the header so it costs no row of its own.
  statusText?: string;
}

const DEFAULT_DISPLAY_NAME = "Session Analyzer";

export function AppHeader({
  mode,
  onModeChange,
  hasConfigWarnings,
  onConfigClick,
  providers = [],
  activeProviderId,
  onProviderChange,
  minRetainedSessionLogsThreshold,
  onRetentionThresholdChange,
  displayName = DEFAULT_DISPLAY_NAME,
  providerSelect = true,
  profilePending = false,
  statusText,
}: AppHeaderProps) {
  return (
    <header className="nav">
      {/* The brand; the VS Code theme hides it, since the editor tab
          already names the panel (step 10.11). */}
      <div className="nav-brand-block">
        <Blueprint className="nav-logo" />
        {profilePending ? (
          <div data-testid="brand-placeholder" aria-busy="true" className="nav-brand-placeholder" />
        ) : (
          <div className="nav-brand">{displayName}</div>
        )}
      </div>
      <div className="mr-auto" />
      <SegmentedControl name="mode" options={MODE_OPTIONS} value={mode} onChange={onModeChange} />
      {!profilePending && providerSelect && mode === "analyze" && providers.length > 0 && onProviderChange && (
        <label className="nav-field">
          <span className="text-muted text-2xs">
            Source
          </span>
          <select
            aria-label="Log provider"
            className="input"
            value={activeProviderId}
            onChange={(event) => onProviderChange(event.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id} disabled={!provider.available}>
                {provider.label}
                {provider.available ? "" : " (unavailable)"}
              </option>
            ))}
          </select>
        </label>
      )}
      {minRetainedSessionLogsThreshold !== undefined && onRetentionThresholdChange && (
        <label className="nav-field">
          <span className="text-muted text-2xs">
            Retention
          </span>
          <input
            aria-label="Retention threshold"
            className="input"
            style={{ width: "6em" }}
            type="number"
            min={1}
            step={1}
            defaultValue={minRetainedSessionLogsThreshold}
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value > 0) {
                onRetentionThresholdChange(value);
              }
            }}
          />
        </label>
      )}
      {statusText !== undefined && (
        <span className="text-muted app-status app-status--inline">{statusText}</span>
      )}
      {hasConfigWarnings ? (
        <button
          className="btn btn-secondary ml-2"
          onClick={onConfigClick}
        >
          Config
        </button>
      ) : (
        <Tag variant="neutral" className="ml-2">
          Config &#10003;
        </Tag>
      )}
    </header>
  );
}
