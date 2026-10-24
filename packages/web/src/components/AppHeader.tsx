import type { LogProviderDescriptor } from "@copilot-cost-analyzer/domain";
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
}: AppHeaderProps) {
  return (
    <header className="nav">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginRight: "auto" }}>
        <Blueprint
          style={{ width: 32, height: 32, flex: "none", background: "var(--color-accent-900)" }}
        />
        {profilePending ? (
          <div data-testid="brand-placeholder" aria-busy="true" className="nav-brand-placeholder" />
        ) : (
          <div>
            <div className="nav-brand">{displayName}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
              GitHub Copilot Chat
            </div>
          </div>
        )}
      </div>
      <SegmentedControl name="mode" options={MODE_OPTIONS} value={mode} onChange={onModeChange} />
      {!profilePending && providerSelect && mode === "analyze" && providers.length > 0 && onProviderChange && (
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", marginLeft: "var(--space-2)" }}>
          <span className="text-muted" style={{ fontSize: 11 }}>
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
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", marginLeft: "var(--space-2)" }}>
          <span className="text-muted" style={{ fontSize: 11 }}>
            Retention
          </span>
          <input
            aria-label="Retention threshold"
            className="input"
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
      {hasConfigWarnings ? (
        <button
          className="btn btn-secondary"
          style={{ marginLeft: "var(--space-2)" }}
          onClick={onConfigClick}
        >
          Config
        </button>
      ) : (
        <Tag variant="neutral" style={{ marginLeft: "var(--space-2)" }}>
          Config &#10003;
        </Tag>
      )}
    </header>
  );
}
