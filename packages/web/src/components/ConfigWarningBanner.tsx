import type { ConfigWarning } from "@agent-cost-analyzer/domain";
import { Blueprint } from "./ui/Blueprint.js";

interface ConfigWarningBannerProps {
  warnings: ConfigWarning[];
  onDismiss: () => void;
  // Opens a warning's setting in the host's settings UI (vscode-extension.md
  // G8). Passed only when the product offers setting fixes and the host can
  // open a setting; without it there are no fix buttons.
  onFixSetting?: (settingId: string) => void;
}

// Fix-button wording per warning, after the first-run mock-up
// (docs/plans/mockups/vscode-extension/FirstRun.dc.html): "Enable" for an
// off switch, "Change" for a number. Debug logging, the one fix every
// session depends on, is the primary action.
const FIX_ACTIONS: Record<ConfigWarning["code"], { label: string; variant: "btn-primary" | "btn-secondary" }> = {
  "logging-disabled": { label: "Enable", variant: "btn-primary" },
  "retention-too-low": { label: "Change", variant: "btn-secondary" },
  "agent-traces-unavailable": { label: "Enable", variant: "btn-secondary" },
  "copilot-chat-unavailable": { label: "Open Extensions", variant: "btn-primary" },
  "settings-not-found": { label: "Open setting", variant: "btn-secondary" },
};

export function ConfigWarningBanner({ warnings, onDismiss, onFixSetting }: ConfigWarningBannerProps) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <Blueprint
      role="alert"
      style={{
        margin: "var(--space-3) var(--space-4) 0",
        padding: "var(--space-2) var(--space-3)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        background: "var(--color-accent-100)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: 1 }}>
        {warnings.map((warning) => {
          // Optional warnings (e.g. agent-traces-unavailable) are additive
          // enrichments the app works fully without — a muted tone keeps
          // them visually distinct from required warnings, which block all
          // usage data until fixed.
          const tone =
            warning.severity === "optional" ? "--color-accent-2" : "--color-accent";
          return (
            <div key={warning.code} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
              <div
                data-severity={warning.severity}
                style={{
                  width: 18,
                  height: 18,
                  flex: "none",
                  border: `1px solid var(${tone}-800)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontFamily: "var(--font-heading)",
                  color: `var(${tone}-800)`,
                }}
              >
                !
              </div>
              <div style={{ fontSize: 13 }}>
                <p style={{ margin: 0 }}>
                  <strong>{warning.message}</strong>
                </p>
                <p style={{ margin: "4px 0 0" }}>
                  {warning.settingId}: current {String(warning.currentValue)}, recommended{" "}
                  {String(warning.recommendedValue)}
                </p>
                <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {warning.helpSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
              {onFixSetting && (
                <button
                  type="button"
                  className={`btn ${FIX_ACTIONS[warning.code].variant}`}
                  style={{ flex: "none", marginLeft: "auto" }}
                  // The visible verb plus the setting it opens, so each
                  // button's name is unique and starts with its label.
                  aria-label={`${FIX_ACTIONS[warning.code].label} ${warning.settingId}`}
                  title={`Open ${warning.settingId} in Settings`}
                  onClick={() => onFixSetting(warning.settingId)}
                >
                  {FIX_ACTIONS[warning.code].label}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button className="btn btn-ghost" style={{ flex: "none" }} onClick={onDismiss}>
        Dismiss
      </button>
    </Blueprint>
  );
}
