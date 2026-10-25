import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConfigWarning } from "@agent-cost-analyzer/domain";
import { ConfigWarningBanner } from "./ConfigWarningBanner.js";

const warning: ConfigWarning = {
  code: "retention-too-low",
  severity: "required",
  settingId: "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
  currentValue: 50,
  recommendedValue: 200,
  message: "Only the last 50 sessions' logs are retained on disk.",
  helpSteps: ["Set maxRetainedSessionLogs to 200 in settings.json", "Reload VS Code"],
};

const otherWarning: ConfigWarning = {
  code: "logging-disabled",
  severity: "required",
  settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
  currentValue: false,
  recommendedValue: true,
  message: "Debug logging is off.",
  helpSteps: ["Set fileLogging.enabled to true", "Reload VS Code"],
};

const optionalWarning: ConfigWarning = {
  code: "agent-traces-unavailable",
  severity: "optional",
  settingId: "github.copilot.chat.otel.dbSpanExporter.enabled",
  currentValue: false,
  recommendedValue: true,
  message: "Cache-write and reasoning-token counts aren't available yet.",
  helpSteps: ["Set dbSpanExporter.enabled to true", "Reload VS Code"],
};

describe("ConfigWarningBanner", () => {
  it("renders nothing when there are no warnings", () => {
    render(<ConfigWarningBanner warnings={[]} onDismiss={vi.fn()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the setting, current vs. recommended value, and fix steps for each warning", () => {
    render(<ConfigWarningBanner warnings={[warning]} onDismiss={vi.fn()} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(warning.message)).toBeInTheDocument();
    expect(
      screen.getByText(`${warning.settingId}: current 50, recommended 200`),
    ).toBeInTheDocument();
    for (const step of warning.helpSteps) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it("renders one section per warning when there are multiple", () => {
    render(<ConfigWarningBanner warnings={[warning, otherWarning]} onDismiss={vi.fn()} />);

    expect(screen.getByText(warning.message)).toBeInTheDocument();
    expect(screen.getByText(otherWarning.message)).toBeInTheDocument();
  });

  it("calls onDismiss when the Dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(<ConfigWarningBanner warnings={[warning]} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // Phase 8.5: agent-traces-unavailable is optional-severity — the app works
  // fully without it, unlike the other (required-severity) warning codes —
  // so it must render visually distinct, not as urgent as a blocking one.
  it("renders a required-severity warning with the required-tone marker", () => {
    const { container } = render(
      <ConfigWarningBanner warnings={[warning]} onDismiss={vi.fn()} />,
    );

    const marker = container.querySelector('[data-severity="required"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("style")).toContain("var(--color-accent-800)");
  });

  it("renders an optional-severity warning with a distinct, muted tone marker", () => {
    const { container } = render(
      <ConfigWarningBanner warnings={[optionalWarning]} onDismiss={vi.fn()} />,
    );

    const marker = container.querySelector('[data-severity="optional"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("style")).toContain("var(--color-accent-2-800)");
    expect(marker?.getAttribute("style")).not.toContain("var(--color-accent-800)");
  });

  // vscode-extension.md G8/step 10.5: one-click fixes, extension only. The
  // banner gets onFixSetting only when the product offers setting fixes
  // and the host can open a setting.
  describe("Fix buttons", () => {
    it("shows no fix button without onFixSetting (standalone)", () => {
      render(<ConfigWarningBanner warnings={[warning, otherWarning, optionalWarning]} onDismiss={vi.fn()} />);

      expect(screen.getAllByRole("button")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    });

    it("labels each warning's button the way the first-run mock-up does", () => {
      render(
        <ConfigWarningBanner warnings={[otherWarning, warning, optionalWarning]} onDismiss={vi.fn()} onFixSetting={vi.fn()} />,
      );

      expect(screen.getByRole("button", { name: `Enable ${otherWarning.settingId}` })).toHaveTextContent(/^Enable$/);
      expect(screen.getByRole("button", { name: `Change ${warning.settingId}` })).toHaveTextContent(/^Change$/);
      expect(screen.getByRole("button", { name: `Enable ${optionalWarning.settingId}` })).toHaveTextContent(/^Enable$/);
    });

    it("opens a logging-disabled warning's setting", () => {
      const onFixSetting = vi.fn();
      render(<ConfigWarningBanner warnings={[otherWarning]} onDismiss={vi.fn()} onFixSetting={onFixSetting} />);

      fireEvent.click(screen.getByRole("button", { name: "Enable github.copilot.chat.agentDebugLog.fileLogging.enabled" }));

      expect(onFixSetting).toHaveBeenCalledWith("github.copilot.chat.agentDebugLog.fileLogging.enabled");
    });

    it("opens the retention setting from its Change button", () => {
      const onFixSetting = vi.fn();
      render(<ConfigWarningBanner warnings={[warning]} onDismiss={vi.fn()} onFixSetting={onFixSetting} />);

      fireEvent.click(screen.getByRole("button", { name: `Change ${warning.settingId}` }));

      expect(onFixSetting).toHaveBeenCalledWith(warning.settingId);
    });

    it("offers to open the setting when settings.json wasn't found", () => {
      const onFixSetting = vi.fn();
      const notFound: ConfigWarning = { ...otherWarning, code: "settings-not-found", message: "No settings.json." };
      render(<ConfigWarningBanner warnings={[notFound]} onDismiss={vi.fn()} onFixSetting={onFixSetting} />);

      fireEvent.click(screen.getByRole("button", { name: `Open setting ${notFound.settingId}` }));

      expect(onFixSetting).toHaveBeenCalledWith(notFound.settingId);
    });

    it("does not dismiss the banner when a fix is clicked", () => {
      const onDismiss = vi.fn();
      render(<ConfigWarningBanner warnings={[otherWarning]} onDismiss={onDismiss} onFixSetting={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: `Enable ${otherWarning.settingId}` }));

      expect(onDismiss).not.toHaveBeenCalled();
    });
  });
});
