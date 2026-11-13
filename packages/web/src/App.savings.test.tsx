// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProductFeatures, ProductProfile, Session } from "@agent-cost-analyzer/domain";
import { App } from "./App.js";
import { resetApiTransport, setApiTransport } from "./api-client/current-transport.js";
import { resetViewStateStorage, setViewStateStorage } from "./state/current-view-state-storage.js";
import { memoryViewStateStorage } from "./state/view-state-storage.js";
import { sampleInsightsDataset } from "./test-support/insights-fixture.js";
import { makeSavingsReport } from "./test-support/savings-fixture.js";
import { makeTurn } from "./test-support/turn-fixture.js";

// Phase 16 SR14: where the Savings tab sits (owner decisions, SR11 questions
// 8, 9 and 11): after Billing in the standalone app, after Dashboard in the
// extension, and only when ProductFeatures.savingsReport is on.

const BASE_FEATURES: ProductFeatures = {
  providerSelect: true,
  crossProviderInsights: true,
  settingFixes: false,
  openInEditor: false,
  sessionSidebar: false,
  vendorSimulation: false,
  costAnalysis: true,
  projectsAndBilling: true,
  sessionReplay: false,
  savingsReport: true,
};

const standalone = (features: Partial<ProductFeatures> = {}): ProductProfile => ({
  productId: "standalone",
  displayName: "Agent Cost Analyzer",
  version: "0.13.0",
  features: { ...BASE_FEATURES, ...features },
});
const extension = (features: Partial<ProductFeatures> = {}): ProductProfile =>
  standalone({ providerSelect: false, crossProviderInsights: false, settingFixes: true, openInEditor: true, costAnalysis: true, projectsAndBilling: false, ...features });

const summary: Session = {
  id: "session-2",
  mode: "analyze",
  title: "Fix the bug",
  model: "claude-sonnet",
  providerId: "vscode",
  usageDataAvailable: true,
  turns: [],
  turnCount: 1,
  costAiCredits: { known: true, value: 1 },
};
const full: Session = { ...summary, turns: [makeTurn({ index: 0 })] };

describe("App: the Savings tab", () => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let profile: ProductProfile;

  beforeEach(() => {
    calls.length = 0;
    setViewStateStorage(memoryViewStateStorage());
    setApiTransport({
      call: ((method: string, params?: Record<string, unknown>) => {
        calls.push({ method, params: params ?? {} });
        const answers: Record<string, unknown> = {
          getProductProfile: profile,
          getHealth: { status: "ok", version: "0.13.0" },
          listLearnScenarios: [],
          listVendorProfiles: [],
          getLogProviderStatus: { providers: [{ id: "vscode", label: "GitHub Copilot, VS Code", available: true }, { id: "claude-code", label: "Claude Code", available: true }], activeProviderId: "vscode" },
          setActiveLogProvider: { providers: [{ id: "vscode", label: "GitHub Copilot, VS Code", available: true }, { id: "claude-code", label: "Claude Code", available: true }], activeProviderId: "claude-code" },
          listSessions: [summary],
          getSession: full,
          getInsights: sampleInsightsDataset(),
          getSavingsReport: makeSavingsReport(),
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

  async function openAnalyze() {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByLabelText("Analyze"));
    return user;
  }

  it("is a Dashboard view after Billing in the standalone app, Include simulated off, and links say 'Open in Analyze'", async () => {
    profile = standalone();
    const user = await openAnalyze();
    await user.click(await screen.findByLabelText("Dashboard"));
    const views = await screen.findByRole("radiogroup", { name: "Dashboard view" });
    expect(within(views).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label") ?? radio.parentElement?.textContent)).toEqual(
      ["Overview", "Cost over time", "Compare", "Project", "Billing", "Savings"],
    );

    await user.click(within(views).getByLabelText("Savings"));

    expect(await screen.findByRole("heading", { name: "AI Credits" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include simulated" })).not.toBeChecked();
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "getSavingsReport")?.params).toMatchObject({ pricing: "as-of-use", includeSimulated: false });
  });

  it("opens a row's session in the turns view, switching to that session's provider first", async () => {
    profile = standalone();
    const user = await openAnalyze();
    await user.click(await screen.findByLabelText("Dashboard"));
    await user.click(await screen.findByLabelText("Savings"));
    await user.click(within((await screen.findAllByTestId("savings-row")).find((row) => row.textContent?.includes("claude-opus-5.5"))!).getByRole("button"));

    await user.click(within(screen.getByRole("region", { name: "Savings detail" })).getByRole("button", { name: "Open in Analyze: cc-1" }));

    await waitFor(() => expect(calls.some((call) => call.method === "getSession" && call.params.id === "cc-1")).toBe(true));
    expect(calls.findIndex((call) => call.method === "setActiveLogProvider")).toBeLessThan(calls.findIndex((call) => call.method === "getSession" && call.params.id === "cc-1"));
    expect(calls.find((call) => call.method === "setActiveLogProvider")?.params).toEqual({ id: "claude-code" });
  });

  it("is a view after Dashboard in the extension, Copilot sessions only, and links say 'Open session'", async () => {
    profile = extension({ sessionSidebar: true });
    const user = await openAnalyze();
    const radios = (await screen.findAllByRole("radio")).map((radio) => radio.getAttribute("aria-label") ?? radio.closest("label")?.textContent);
    expect(radios.indexOf("Savings")).toBe(radios.indexOf("Dashboard") + 1);

    await user.click(screen.getByLabelText("Savings"));

    expect(await screen.findByText("GitHub Copilot sessions only")).toBeInTheDocument();
    expect(screen.getByText(/Claude Code and pi savings are in the standalone app\./)).toBeInTheDocument();
    expect(screen.queryByLabelText("Provider")).not.toBeInTheDocument();
    await user.click(within((await screen.findAllByTestId("savings-row"))[0]!).getByRole("button"));
    expect(within(screen.getByRole("region", { name: "Savings detail" })).getAllByRole("button", { name: /^Open session:/ })).not.toHaveLength(0);
  });

  it("has no Savings tab when the product does not offer the report", async () => {
    profile = standalone({ savingsReport: false });
    const user = await openAnalyze();
    await user.click(await screen.findByLabelText("Dashboard"));
    await screen.findByRole("radiogroup", { name: "Dashboard view" });

    expect(screen.queryByLabelText("Savings")).not.toBeInTheDocument();
  });

  it("has no Savings view in the extension when the report is off", async () => {
    profile = extension({ sessionSidebar: true, savingsReport: false });
    await openAnalyze();
    await screen.findByLabelText("Dashboard");

    expect(screen.queryByLabelText("Savings")).not.toBeInTheDocument();
  });
});
