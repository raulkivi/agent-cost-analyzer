// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductFeatures, ProductProfile } from "@agent-cost-analyzer/domain";
import { App } from "./App.js";
import * as allowanceClient from "./api-client/monthly-allowance.js";
import { resetApiTransport, setApiTransport } from "./api-client/current-transport.js";
import { resetViewStateStorage, setViewStateStorage } from "./state/current-view-state-storage.js";
import { memoryViewStateStorage } from "./state/view-state-storage.js";
import { nearAnswer } from "./test-support/allowance-fixture.js";

// MS7 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/monthly-allowance-standalone.md §4.7, D3, D4): the gauge sits in the
// header after the provider select, in Analyze mode only, and only where the
// product turns ProductFeatures.monthlyAllowance on. The extension never
// shows it.

vi.mock("./api-client/monthly-allowance.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api-client/monthly-allowance.js")>()),
  getMonthlyAllowance: vi.fn(),
  setMonthlyAllowance: vi.fn(),
}));

const get = vi.mocked(allowanceClient.getMonthlyAllowance);

const BASE_FEATURES: ProductFeatures = {
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
  monthlyAllowance: true,
};

let profile: ProductProfile;
const standalone = (features: Partial<ProductFeatures> = {}): ProductProfile => ({
  productId: "standalone",
  displayName: "Agent Cost Analyzer",
  version: "1.0.0",
  features: { ...BASE_FEATURES, ...features },
});
const extension = (): ProductProfile =>
  standalone({ providerSelect: false, crossProviderInsights: false, settingFixes: true, openInEditor: true, monthlyAllowance: false });

const GAUGE = /Near limit\. AI Credits this month/;

describe("App: the monthly allowance gauge", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue(nearAnswer());
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
    resetViewStateStorage();
  });

  it("shows in Analyze mode after the Source select, and loads when Analyze is entered", async () => {
    profile = standalone();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByLabelText("Analyze"));

    const gauge = await screen.findByRole("button", { name: GAUGE });
    const source = screen.getByLabelText("Log provider");
    expect(source.compareDocumentPosition(gauge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("banner")).toHaveClass("nav--allowance");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("is absent in Learn mode, and leaves again when Learn is chosen", async () => {
    profile = standalone();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Learn");
    expect(get).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText("Analyze"));
    await screen.findByRole("button", { name: GAUGE });
    await user.click(screen.getByLabelText("Learn"));

    expect(screen.queryByRole("button", { name: GAUGE })).toBeNull();
    expect(screen.getByRole("banner")).not.toHaveClass("nav--allowance");
  });

  it("is absent where the product flag is off: the extension never asks for it", async () => {
    profile = extension();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByLabelText("Analyze"));

    await waitFor(() => expect(screen.getByLabelText("Analyze")).toBeChecked());
    expect(screen.queryByRole("button", { name: GAUGE })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("draws nothing when the server has no allowance (404)", async () => {
    profile = standalone();
    get.mockRejectedValue(new allowanceClient.AllowanceUnavailable());
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByLabelText("Analyze"));

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /allowance|AI Credits this month/i })).toBeNull();
  });
});
