// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductProfile, Session } from "@agent-cost-analyzer/domain";
import { App } from "./App.js";
import { ApiRequestError } from "./api-client/api-request-error.js";
import { resetApiTransport, setApiTransport } from "./api-client/current-transport.js";
import { resetViewStateStorage, setViewStateStorage } from "./state/current-view-state-storage.js";
import { memoryViewStateStorage } from "./state/view-state-storage.js";
import { makeReplay, NOT_REPLAYED_REASON, REPLAY_PROFILES } from "./test-support/replay-fixture.js";
import { makeTurn } from "./test-support/turn-fixture.js";

// B's Compare models view is tested on its own; here only what App hands it.
vi.mock("./components/replay/CompareModelsView.js", () => ({
  CompareModelsView: (props: { sessionId: string; providerId?: string; initialModels: string[]; pricing: string; onPricingChange(pricing: string): void }) => (
    <section aria-label="Compare models view">
      <span data-testid="compare-props">{JSON.stringify({ sessionId: props.sessionId, providerId: props.providerId, initialModels: props.initialModels, pricing: props.pricing })}</span>
      <button type="button" onClick={() => props.onPricingChange("api")}>
        Compare at API prices
      </button>
    </section>
  ),
}));

const standalone: ProductProfile = {
  productId: "standalone",
  displayName: "Agent Cost Analyzer",
  version: "0.9.0",
  features: {
    providerSelect: true,
    crossProviderInsights: true,
    settingFixes: false,
    openInEditor: false,
    sessionSidebar: false,
    vendorSimulation: true,
    costAnalysis: false,
    projectsAndBilling: false,
    sessionReplay: true,
    savingsReport: true,
  },
};

const summary = (id: string, title: string, providerId: string): Session => ({
  id,
  mode: "analyze",
  title,
  model: "claude-opus-5-5",
  providerId,
  usageDataAvailable: true,
  turns: [],
  turnCount: 3,
  costAiCredits: { known: true, value: 80 },
});

const claudeSession: Session = {
  ...summary("s1", "Refactor the price book loader", "claude-code"),
  turns: [0, 1, 2].map((index) => makeTurn({ index, explanation: `turn ${index} explanation` })),
};
const piSession: Session = { ...summary("p1", "Fix the flaky snapshot test", "pi"), turns: [makeTurn({ index: 0 })] };

describe("Analyze mode: replay a session on another model (step 14.7)", () => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let profile: ProductProfile;
  let replayAnswer: (params: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    calls.length = 0;
    profile = structuredClone(standalone);
    replayAnswer = (params) => Promise.resolve(makeReplay({ model: String(params.model) }));
    setViewStateStorage(memoryViewStateStorage());
    setApiTransport({
      call: ((method: string, params?: Record<string, unknown>) => {
        calls.push({ method, params: params ?? {} });
        if (method === "getSessionReplay") return replayAnswer(params ?? {});
        if (method === "getSession") return Promise.resolve(params?.id === "p1" ? piSession : claudeSession);
        const answers: Record<string, unknown> = {
          getProductProfile: profile,
          getHealth: { status: "ok", version: "0.9.0" },
          listLearnScenarios: [],
          listVendorProfiles: REPLAY_PROFILES,
          getLogProviderStatus: { providers: [{ id: "claude-code", label: "Claude Code", available: true }], activeProviderId: "claude-code" },
          listSessions: [summary("s1", "Refactor the price book loader", "claude-code"), summary("p1", "Fix the flaky snapshot test", "pi")],
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

  async function openSession(title: string) {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByLabelText("Analyze"));
    await user.click(await screen.findByRole("button", { name: new RegExp(title) }));
    await screen.findByRole("heading", { name: title });
    return user;
  }

  const replayCalls = () => calls.filter((call) => call.method === "getSessionReplay").map((call) => call.params);

  it("adds the summary strip and the Simulated columns when a model is chosen, and removes them on Off", async () => {
    const user = await openSession("Refactor the price book loader");
    const picker = await screen.findByLabelText("Replay on");
    expect(screen.getByText(/Choose a model in Replay on/)).toBeInTheDocument();
    expect(replayCalls()).toEqual([]);

    await user.selectOptions(picker, "claude-sonnet-5.5");
    const strip = await screen.findByRole("region", { name: "Replay summary" });
    expect(strip).toHaveTextContent("would have cost about $0.48 on claude-sonnet-5.5");
    expect(replayCalls()).toEqual([{ sessionId: "s1", model: "claude-sonnet-5.5", provider: "claude-code" }]);
    expect(screen.getByRole("columnheader", { name: "Simulated claude-sonnet-5.5" })).toBeInTheDocument();
    expect(screen.getByText(NOT_REPLAYED_REASON, { selector: ".sim-cell span" })).toBeInTheDocument();
    // The selected turn's simulated note in the Explanation column.
    expect(screen.getByRole("region", { name: "Simulated on claude-sonnet-5.5" })).toHaveTextContent("Partial");

    await user.selectOptions(picker, "");
    expect(screen.queryByRole("region", { name: "Replay summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Simulated claude-sonnet-5.5" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Simulated on claude-sonnet-5.5" })).not.toBeInTheDocument();
  });

  it("refetches with pricing=copilot when the summary's price channel switches", async () => {
    const user = await openSession("Refactor the price book loader");
    await user.selectOptions(await screen.findByLabelText("Replay on"), "claude-sonnet-5.5");
    await user.click(await screen.findByRole("button", { name: "Replay summary" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "GitHub Copilot" }));

    await waitFor(() => expect(replayCalls().at(-1)).toEqual({ sessionId: "s1", model: "claude-sonnet-5.5", pricing: "copilot", provider: "claude-code" }));
  });

  it("opens and closes the summary by keyboard, giving focus back to its button", async () => {
    const user = await openSession("Refactor the price book loader");
    await user.selectOptions(await screen.findByLabelText("Replay on"), "claude-sonnet-5.5");
    const button = await screen.findByRole("button", { name: "Replay summary" });
    button.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("disables the picker for a pi session with the reason, and asks for nothing (D1)", async () => {
    await openSession("Fix the flaky snapshot test");
    const picker = await screen.findByLabelText("Replay on");
    expect(picker).toBeDisabled();
    expect(picker).toHaveAccessibleDescription("This provider's logs can't be replayed yet.");
    expect(replayCalls()).toEqual([]);
  });

  it("shows a 404's reason in the API's words", async () => {
    replayAnswer = () => Promise.reject(new ApiRequestError("/api/sessions/s1/replay?model=claude-sonnet-5.5", 404, "Session too long to replay: it has 23,418 requests; at most 20,000 can be replayed."));
    const user = await openSession("Refactor the price book loader");
    await user.selectOptions(await screen.findByLabelText("Replay on"), "claude-sonnet-5.5");

    const status = await screen.findByText("This session can't be replayed");
    expect(status.closest("[role=status]")).toHaveTextContent("at most 20,000 can be replayed.");
    expect(screen.queryByRole("columnheader", { name: "Simulated claude-sonnet-5.5" })).not.toBeInTheDocument();
  });

  it("swaps the turns table for Compare models, with the chosen, own and default models and the shared pricing", async () => {
    const user = await openSession("Refactor the price book loader");
    await user.selectOptions(await screen.findByLabelText("Replay on"), "claude-haiku-5.5");
    await screen.findByRole("region", { name: "Replay summary" });
    const toggle = screen.getByRole("button", { name: "Compare models" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("columnheader", { name: "Cumulative" })).not.toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("compare-props").textContent!)).toEqual({
      sessionId: "s1",
      providerId: "claude-code",
      initialModels: ["claude-haiku-5.5", "claude-opus-5.5", "claude-sonnet-5.5", "gpt-6.1-sol"],
      pricing: "session-channel",
    });
    await user.click(screen.getByRole("button", { name: "Compare at API prices" }));
    expect(JSON.parse(screen.getByTestId("compare-props").textContent!).pricing).toBe("api");
    await waitFor(() => expect(replayCalls().at(-1)).toMatchObject({ pricing: "api" }));

    await user.click(toggle);
    expect(await screen.findByRole("columnheader", { name: "Cumulative" })).toBeInTheDocument();
  });

  it("offers no replay when the product doesn't", async () => {
    profile.features.sessionReplay = false;
    await openSession("Refactor the price book loader");
    expect(screen.queryByLabelText("Replay on")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare models" })).not.toBeInTheDocument();
  });
});
