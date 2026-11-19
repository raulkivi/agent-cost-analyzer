// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductProfile } from "@agent-cost-analyzer/domain";
import { App } from "./App.js";
import { resetApiTransport, setApiTransport } from "./api-client/current-transport.js";
import { resetHostCapabilities, setHostCapabilities } from "./host/current-host-capabilities.js";
import { resetViewStateStorage, setViewStateStorage } from "./state/current-view-state-storage.js";
import { memoryViewStateStorage } from "./state/view-state-storage.js";

// mcp-client-setup.md §5.6.1: the header button sits after Retention in
// Learn and Analyze mode, and only the standalone host offers it.

const profile: ProductProfile = {
  productId: "standalone",
  displayName: "Agent Cost Analyzer",
  version: "1.0.0",
  features: {
    providerSelect: true,
    crossProviderInsights: true,
    settingFixes: false,
    openInEditor: false,
    sessionSidebar: false,
    vendorSimulation: false,
    costAnalysis: false,
    projectsAndBilling: false,
    sessionReplay: false,
    savingsReport: false,
    monthlyAllowance: false,
  },
};

const BUTTON = { name: "Connect an agent" };

describe("App: the Connect an agent button", () => {
  beforeEach(() => {
    setViewStateStorage(memoryViewStateStorage());
    setApiTransport({
      call: ((method: string) => {
        const answers: Record<string, unknown> = {
          getProductProfile: profile,
          getHealth: { status: "ok", version: "1.0.0" },
          listLearnScenarios: [],
          listVendorProfiles: [],
          getLogProviderStatus: { providers: [{ id: "vscode", label: "VS Code (local Copilot Chat)", available: true }], activeProviderId: "vscode" },
          listSessions: [],
          getConfigStatus: { checkedAt: "2026-11-07T00:00:00.000Z", vscodeUserSettingsPath: "/x", loggingEnabled: true, minRetainedSessionLogsThreshold: 200, warnings: [] },
        };
        return method in answers ? Promise.resolve(answers[method]) : Promise.reject(new Error(`unexpected ${method}`));
      }) as never,
    });
  });
  afterEach(() => {
    resetApiTransport();
    resetHostCapabilities();
    resetViewStateStorage();
    vi.unstubAllGlobals();
  });

  it("shows after Retention in Learn mode and stays in Analyze mode", async () => {
    const user = userEvent.setup();
    render(<App />);

    const button = await screen.findByRole("button", BUTTON);
    const retention = screen.getByLabelText("Retention threshold");
    expect(retention.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByLabelText("Analyze"));
    expect(await screen.findByRole("button", BUTTON)).toBeInTheDocument();
  });

  it("is absent in the VS Code panel, whose host cannot offer it", async () => {
    setHostCapabilities({ copyToClipboard: vi.fn() });
    render(<App />);

    await screen.findByLabelText("Retention threshold");
    expect(screen.queryByRole("button", BUTTON)).toBeNull();
  });
});
