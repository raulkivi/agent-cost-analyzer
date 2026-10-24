import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader.js";

describe("AppHeader", () => {
  it("renders the wordmark and caption", () => {
    render(
      <AppHeader mode="learn" onModeChange={vi.fn()} hasConfigWarnings={false} onConfigClick={vi.fn()} />,
    );

    expect(screen.getByText("Session Analyzer")).toBeInTheDocument();
    expect(screen.getByText("GitHub Copilot Chat")).toBeInTheDocument();
  });

  it("renders a Learn/Analyze mode switch reflecting the current mode", () => {
    render(
      <AppHeader mode="analyze" onModeChange={vi.fn()} hasConfigWarnings={false} onConfigClick={vi.fn()} />,
    );

    expect(screen.getByLabelText("Analyze")).toBeChecked();
    expect(screen.getByLabelText("Learn")).not.toBeChecked();
  });

  it("calls onModeChange when a different mode is selected", () => {
    const onModeChange = vi.fn();
    render(
      <AppHeader mode="learn" onModeChange={onModeChange} hasConfigWarnings={false} onConfigClick={vi.fn()} />,
    );

    fireEvent.click(screen.getByLabelText("Analyze"));

    expect(onModeChange).toHaveBeenCalledWith("analyze");
  });

  it("renders a clickable Config button when there are warnings", () => {
    const onConfigClick = vi.fn();
    render(
      <AppHeader mode="learn" onModeChange={vi.fn()} hasConfigWarnings={true} onConfigClick={onConfigClick} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Config" }));

    expect(onConfigClick).toHaveBeenCalledTimes(1);
  });

  it("renders a static 'Config ✓' tag with no button when there are no warnings", () => {
    render(
      <AppHeader mode="learn" onModeChange={vi.fn()} hasConfigWarnings={false} onConfigClick={vi.fn()} />,
    );

    expect(screen.getByText("Config ✓")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Config" })).not.toBeInTheDocument();
  });

  const providers = [
    { id: "vscode", label: "VS Code", available: true },
    { id: "mitmproxy", label: "mitmproxy", available: false, unavailableReason: "not configured" },
  ];

  it("does not render a provider select in Learn mode", () => {
    render(
      <AppHeader
        mode="learn"
        onModeChange={vi.fn()}
        hasConfigWarnings={false}
        onConfigClick={vi.fn()}
        providers={providers}
        activeProviderId="vscode"
        onProviderChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Log provider")).not.toBeInTheDocument();
  });

  it("does not render a provider select when no providers are supplied", () => {
    render(
      <AppHeader mode="analyze" onModeChange={vi.fn()} hasConfigWarnings={false} onConfigClick={vi.fn()} />,
    );

    expect(screen.queryByLabelText("Log provider")).not.toBeInTheDocument();
  });

  it("renders a provider select in Analyze mode reflecting the active provider", () => {
    render(
      <AppHeader
        mode="analyze"
        onModeChange={vi.fn()}
        hasConfigWarnings={false}
        onConfigClick={vi.fn()}
        providers={providers}
        activeProviderId="vscode"
        onProviderChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Log provider")).toHaveValue("vscode");
    expect(screen.getByRole("option", { name: /VS Code/ })).not.toBeDisabled();
    expect(screen.getByRole("option", { name: /mitmproxy \(unavailable\)/ })).toBeDisabled();
  });

  it("calls onProviderChange when a different provider is selected", () => {
    const onProviderChange = vi.fn();
    render(
      <AppHeader
        mode="analyze"
        onModeChange={vi.fn()}
        hasConfigWarnings={false}
        onConfigClick={vi.fn()}
        providers={providers}
        activeProviderId="vscode"
        onProviderChange={onProviderChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Log provider"), { target: { value: "mitmproxy" } });

    expect(onProviderChange).toHaveBeenCalledWith("mitmproxy");
  });

  it("does not render a retention-threshold control when the new props aren't supplied", () => {
    render(
      <AppHeader mode="learn" onModeChange={vi.fn()} hasConfigWarnings={false} onConfigClick={vi.fn()} />,
    );

    expect(screen.queryByLabelText("Retention threshold")).not.toBeInTheDocument();
  });

  it("renders the retention-threshold control in Learn mode", () => {
    render(
      <AppHeader
        mode="learn"
        onModeChange={vi.fn()}
        hasConfigWarnings={false}
        onConfigClick={vi.fn()}
        minRetainedSessionLogsThreshold={200}
        onRetentionThresholdChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Retention threshold")).toHaveValue(200);
  });

  it("renders the retention-threshold control regardless of hasConfigWarnings", () => {
    const { rerender } = render(
      <AppHeader
        mode="analyze"
        onModeChange={vi.fn()}
        hasConfigWarnings={true}
        onConfigClick={vi.fn()}
        minRetainedSessionLogsThreshold={200}
        onRetentionThresholdChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Retention threshold")).toBeInTheDocument();

    rerender(
      <AppHeader
        mode="analyze"
        onModeChange={vi.fn()}
        hasConfigWarnings={false}
        onConfigClick={vi.fn()}
        minRetainedSessionLogsThreshold={200}
        onRetentionThresholdChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Retention threshold")).toBeInTheDocument();
  });

  it("calls onRetentionThresholdChange with the new numeric value on blur", () => {
    const onRetentionThresholdChange = vi.fn();
    render(
      <AppHeader
        mode="learn"
        onModeChange={vi.fn()}
        hasConfigWarnings={false}
        onConfigClick={vi.fn()}
        minRetainedSessionLogsThreshold={200}
        onRetentionThresholdChange={onRetentionThresholdChange}
      />,
    );

    const input = screen.getByLabelText("Retention threshold");
    fireEvent.change(input, { target: { value: "300" } });
    fireEvent.blur(input);

    expect(onRetentionThresholdChange).toHaveBeenCalledWith(300);
  });

  describe("product profile (vscode-extension.md §3.3, G10)", () => {
    it.each(["Agent Cost Analyzer", "AI Credits Analyzer"])("shows the product's display name %s as the wordmark", (displayName) => {
      render(
        <AppHeader
          mode="learn"
          onModeChange={vi.fn()}
          hasConfigWarnings={false}
          onConfigClick={vi.fn()}
          displayName={displayName}
        />,
      );

      expect(screen.getByText(displayName)).toBeInTheDocument();
      expect(screen.queryByText("Session Analyzer")).not.toBeInTheDocument();
    });

    it("shows the provider select in Analyze mode when the product has one (standalone)", () => {
      render(
        <AppHeader
          mode="analyze"
          onModeChange={vi.fn()}
          hasConfigWarnings={false}
          onConfigClick={vi.fn()}
          providers={providers}
          activeProviderId="vscode"
          onProviderChange={vi.fn()}
          providerSelect={true}
        />,
      );

      expect(screen.getByRole("combobox", { name: "Log provider" })).toBeInTheDocument();
    });

    it("hides the provider select when the product has a single provider (extension)", () => {
      render(
        <AppHeader
          mode="analyze"
          onModeChange={vi.fn()}
          hasConfigWarnings={false}
          onConfigClick={vi.fn()}
          providers={providers}
          activeProviderId="vscode"
          onProviderChange={vi.fn()}
          providerSelect={false}
        />,
      );

      expect(screen.queryByRole("combobox", { name: "Log provider" })).not.toBeInTheDocument();
      expect(screen.queryByText("Source")).not.toBeInTheDocument();
    });

    // Step 10.7 (from 10.5): until the profile resolves or fails, the header
    // can't know the product, so it shows neither product's brand.
    it("holds an empty brand area and no provider select while the profile is pending", () => {
      render(
        <AppHeader
          mode="analyze"
          onModeChange={vi.fn()}
          hasConfigWarnings={false}
          onConfigClick={vi.fn()}
          providers={providers}
          activeProviderId="vscode"
          onProviderChange={vi.fn()}
          profilePending
        />,
      );

      expect(screen.queryByText("Session Analyzer")).not.toBeInTheDocument();
      expect(screen.queryByText("GitHub Copilot Chat")).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Log provider" })).not.toBeInTheDocument();
      expect(screen.getByTestId("brand-placeholder")).toHaveAttribute("aria-busy", "true");
      // The mode switch doesn't depend on the product.
      expect(screen.getByLabelText("Analyze")).toBeChecked();
    });
  });
});
