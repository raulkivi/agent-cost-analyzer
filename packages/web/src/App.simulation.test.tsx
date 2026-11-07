// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductProfile, Session, VendorComparison, VendorProfileSummary } from "@agent-cost-analyzer/domain";
import { App } from "./App.js";
import { resetApiTransport, setApiTransport } from "./api-client/current-transport.js";
import { resetViewStateStorage, setViewStateStorage } from "./state/current-view-state-storage.js";
import { memoryViewStateStorage } from "./state/view-state-storage.js";
import { makeTurn } from "./test-support/turn-fixture.js";

const profile = (vendorId: string, models: [string, boolean][]): VendorProfileSummary => ({
  vendorId,
  displayName: vendorId === "anthropic" ? "Anthropic" : "OpenAI",
  defaultModelId: models[0]![0],
  models: models.map(([modelId, simulated]) => ({
    modelId,
    displayName: modelId,
    simulated,
    ...(simulated ? {} : { reason: "Not simulated: caching behaviour isn't documented" }),
  })),
  assumptions: [{ text: "Copilot places breakpoints after tools.", confidence: "unknown" }],
  sources: [{ id: "s", title: "Anthropic prompt caching", url: "https://example.com/caching", checkedAt: "2026-11-03" }],
  oldestCheckedAt: "2026-11-03",
});

const profiles = [
  profile("anthropic", [["claude-sonnet-5.5", true], ["claude-opus-5.5", true]]),
  profile("openai", [["gpt-6.1-sol", true]]),
];

const simulated = (modelId: string): Session => ({
  id: "cache-basics",
  mode: "learn",
  title: "Cache Basics",
  model: modelId,
  usageDataAvailable: true,
  turnCount: 1,
  costAiCredits: { known: true, value: 1.2 },
  turns: [
    makeTurn({
      index: 1,
      explanation: "vendor neutral text",
      simulation: {
        vendorId: "anthropic",
        modelId,
        cacheOutcome: "miss",
        note: `On ${modelId}: cache miss.`,
        confidence: "inferred",
        sourceIds: [],
      },
    }),
  ],
});

const comparison: VendorComparison = {
  scenarioId: "cache-basics",
  entries: [
    {
      vendorId: "anthropic",
      modelId: "claude-sonnet-5.5",
      displayName: "claude-sonnet-5.5",
      simulated: true,
      totalAiCredits: { known: true, value: 1.2 },
      turns: [{ index: 1, cacheOutcome: "miss", aiCredits: { known: true, value: 1.2 }, note: "Sonnet note", sourceIds: [] }],
    },
    {
      vendorId: "openai",
      modelId: "gpt-6.1-sol",
      displayName: "gpt-6.1-sol",
      simulated: true,
      totalAiCredits: { known: true, value: 0.9 },
      turns: [{ index: 1, cacheOutcome: "hit", aiCredits: { known: true, value: 0.9 }, note: "GPT note", sourceIds: [] }],
    },
  ],
};

const extensionProfile: ProductProfile = {
  productId: "vscode-extension",
  displayName: "AI Credits Analyzer",
  version: "0.2.0",
  features: {
    providerSelect: false,
    crossProviderInsights: false,
    settingFixes: false,
    openInEditor: false,
    sessionSidebar: false,
    vendorSimulation: true,
    costAnalysis: false,
    projectsAndBilling: false,
  },
};

describe("Learn mode with vendor simulation (step 13.7)", () => {
  const calls: { method: string; params: unknown }[] = [];

  beforeEach(() => {
    calls.length = 0;
    setViewStateStorage(memoryViewStateStorage());
    setApiTransport({
      call: ((method: string, params?: unknown) => {
        calls.push({ method, params });
        const answers: Record<string, unknown> = {
          getProductProfile: extensionProfile,
          getHealth: { status: "ok", version: "0.2.0" },
          listLearnScenarios: [simulated("claude-sonnet-5.5")],
          listVendorProfiles: profiles,
          compareScenario: comparison,
          getScenario: simulated((params as { modelId?: string } | undefined)?.modelId ?? "claude-sonnet-5.5"),
          getLogProviderStatus: { providers: [{ id: "vscode", label: "VS Code", available: true }], activeProviderId: "vscode" },
          listSessions: [],
          getConfigStatus: {
            checkedAt: "2026-11-05T00:00:00.000Z",
            vscodeUserSettingsPath: "/x",
            loggingEnabled: true,
            minRetainedSessionLogsThreshold: 200,
            warnings: [],
          },
        };
        return method in answers ? Promise.resolve(answers[method]) : Promise.reject(new Error(`unexpected ${method}`));
      }) as never,
    });
  });
  afterEach(() => {
    resetApiTransport();
    resetViewStateStorage();
    vi.restoreAllMocks();
  });

  it("shows the vendor picker, the cache column, the simulation note and the sources", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /cache basics/i }));

    expect(await screen.findByLabelText("Simulate on")).toHaveValue("claude-sonnet-5.5");
    expect(await screen.findByText("On claude-sonnet-5.5: cache miss.")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Cache" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Anthropic prompt caching" })).toBeInTheDocument();
    expect(screen.getByText(/1 assumption/i)).toBeInTheDocument();
  });

  it("re-simulates the open scenario when another model is picked, and remembers the pick", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /cache basics/i }));
    await user.selectOptions(await screen.findByLabelText("Simulate on"), "gpt-6.1-sol");

    await waitFor(() =>
      expect(calls.filter((c) => c.method === "getScenario").at(-1)?.params).toEqual({
        id: "cache-basics",
        modelId: "gpt-6.1-sol",
      }),
    );
    expect(await screen.findByText("On gpt-6.1-sol: cache miss.")).toBeInTheDocument();
  });

  it("shows How vendors differ for a turn with a cache event", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /cache basics/i }));

    expect(await screen.findByRole("heading", { name: "How vendors differ" })).toBeInTheDocument();
    expect(screen.getByText("Sonnet note")).toBeInTheDocument();
    expect(screen.getByText("GPT note")).toBeInTheDocument();
  });

  it("has a Vendors tab with the sortable comparison, and adding a model refetches", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /cache basics/i }));
    await user.click(await screen.findByLabelText("Vendors"));

    expect(await screen.findByRole("columnheader", { name: "Total AI credits" })).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: /each vendor/ })).getByText("gpt-6.1-sol")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "compareScenario").length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText("Add a model"), "claude-opus-5.5");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "compareScenario").at(-1)?.params).toEqual({
        id: "cache-basics",
        modelIds: ["claude-sonnet-5.5", "gpt-6.1-sol", "claude-opus-5.5"],
      }),
    );
  });

  it("shows no picker when the product has no vendor simulation", async () => {
    extensionProfile.features.vendorSimulation = false;
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /cache basics/i }));
    expect(screen.queryByLabelText("Simulate on")).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === "listVendorProfiles")).toBe(false);
    extensionProfile.features.vendorSimulation = true;
  });
});
