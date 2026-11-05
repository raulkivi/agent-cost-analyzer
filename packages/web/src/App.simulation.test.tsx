import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductProfile, Session, VendorProfileSummary } from "@agent-cost-analyzer/domain";
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
